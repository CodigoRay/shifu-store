import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { sendOrderEmailNotification } from "@/lib/order-email";

export const runtime = "nodejs";

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Falta SUPABASE_SECRET_KEY");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function paypalBaseUrl() {
  return process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function getAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Faltan credenciales PayPal");
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Autenticación PayPal fallida");
  return (await response.json()).access_token as string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orderID = body?.orderID;
    if (typeof orderID !== "string" || !/^[A-Z0-9-]{1,100}$/i.test(orderID)) {
      return NextResponse.json({ error: "Orden no válida" }, { status: 400 });
    }

    const db = adminDb();
    const { data: localOrder, error: localError } = await db.from("orders")
      .select("id,order_number,total,currency,payment_status,paypal_capture_id")
      .eq("paypal_order_id", orderID).single();
    if (localError || !localOrder) {
      return NextResponse.json({ error: "No encontramos el pedido de Shifu Store asociado a este pago" }, { status: 404 });
    }

    // If PayPal retries a completed capture, never capture twice; only retry a failed email notification.
    if (localOrder.payment_status === "completed") {
      const email = await sendOrderEmailNotification(db, localOrder.id, "order_confirmed");
      return NextResponse.json({ status: "COMPLETED", orderID, orderNumber: localOrder.order_number, confirmationEmail: email.status });
    }

    const { data: items, error: itemsError } = await db.from("order_items")
      .select("product_id,product_name,quantity,unit_price,line_total,variant_id,variant_sku,variant_label")
      .eq("order_id", localOrder.id);
    if (itemsError || !items?.length) {
      return NextResponse.json({ error: "El pedido no contiene productos registrados" }, { status: 500 });
    }

    const token = await getAccessToken();
    const lookup = await fetch(`${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderID)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const paypalOrder = await lookup.json();
    if (!lookup.ok) return NextResponse.json({ error: "No se pudo verificar la orden PayPal" }, { status: 400 });

    const unit = paypalOrder.purchase_units?.[0];
    if (paypalOrder.purchase_units?.length !== 1 || unit?.custom_id !== "shifu-store" || unit.amount?.currency_code !== "USD" || unit.amount?.value !== Number(localOrder.total).toFixed(2)) {
      return NextResponse.json({ error: "Los datos del pago no coinciden con el pedido" }, { status: 400 });
    }

    const paypalItems = unit.items;
    if (!Array.isArray(paypalItems) || paypalItems.length !== items.length) {
      return NextResponse.json({ error: "Los productos del pago no coinciden" }, { status: 400 });
    }
    for (const saved of items) {
      const paypalItem = paypalItems.find((item: { sku?: string }) => item.sku === (saved.variant_sku || saved.product_id));
      if (!paypalItem || Number(paypalItem.quantity) !== saved.quantity || paypalItem.unit_amount?.currency_code !== "USD" || paypalItem.unit_amount?.value !== Number(saved.unit_price).toFixed(2)) {
        return NextResponse.json({ error: "No fue posible validar los productos del pago" }, { status: 400 });
      }
    }

    // Prolonga la reserva antes de capturar. Si el checkout supero los 30 minutos,
    // el cliente debe reiniciar la compra y no puede capturar unidades liberadas.
    const { error: renewalError } = await db.rpc("renew_order_inventory_reservation", { p_order_id: localOrder.id });
    if (renewalError) {
      return NextResponse.json({ error: "La reserva de inventario venció. Vuelve a iniciar el checkout para confirmar las existencias." }, { status: 409 });
    }

    let captureId: string | undefined;
    if (paypalOrder.status === "COMPLETED") {
      captureId = unit.payments?.captures?.find((item: { status?: string }) => item.status === "COMPLETED")?.id;
    } else if (paypalOrder.status === "APPROVED") {
      const captureResponse = await fetch(`${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": `capture-${orderID}`,
        },
        body: "{}",
        cache: "no-store",
      });
      const captured = await captureResponse.json();
      const capture = captured.purchase_units?.[0]?.payments?.captures?.[0];
      if (!captureResponse.ok || captured.status !== "COMPLETED" || capture?.status !== "COMPLETED" || capture.amount?.currency_code !== "USD" || capture.amount?.value !== Number(localOrder.total).toFixed(2) || !capture.id) {
        return NextResponse.json({ error: "PayPal no confirmó el pago por el importe esperado" }, { status: 502 });
      }
      captureId = capture.id;
    } else {
      return NextResponse.json({ error: "La orden aún no está aprobada en PayPal" }, { status: 400 });
    }

    if (!captureId) return NextResponse.json({ error: "No encontramos una captura completada" }, { status: 502 });

    // Descuenta stock y convierte las unidades reservadas en venta dentro de
    // una transaccion PostgreSQL, evitando vender dos veces la ultima unidad.
    const { error: inventoryError } = await db.rpc("consume_order_inventory_reservation", { p_order_id: localOrder.id });
    if (inventoryError) {
      console.error("Pago confirmado pero no se pudo consumir la reserva de inventario", inventoryError.code, inventoryError.message);
      return NextResponse.json({ error: "PayPal confirmó el pago, pero necesitamos reconciliar el inventario. Contacta con soporte y conserva tu referencia PayPal." }, { status: 500 });
    }

    const now = new Date().toISOString();
    const { error: updateError } = await db.from("orders")
      .update({ status: "paid", payment_status: "completed", fulfillment_status: "pending", paypal_capture_id: captureId, paid_at: now })
      .eq("id", localOrder.id)
      .neq("payment_status", "completed");
    if (updateError) {
      console.error("No se actualizó pedido pagado", updateError.code);
      return NextResponse.json({ error: "El pago fue confirmado, pero falta registrar su estado. Contacta con soporte con tu referencia PayPal." }, { status: 500 });
    }

    await db.from("payments").upsert({
      order_id: localOrder.id,
      provider: "paypal",
      provider_order_id: orderID,
      provider_capture_id: captureId,
      status: "completed",
      amount: localOrder.total,
      currency: "USD",
    }, { onConflict: "provider_capture_id" });
    await db.from("order_events").insert({ order_id: localOrder.id, event_type: "payment_completed", description: `Pago PayPal confirmado. Captura ${captureId}.` });

    // A mail outage must never roll back a confirmed payment or block the success screen.
    const email = await sendOrderEmailNotification(db, localOrder.id, "order_confirmed");
    return NextResponse.json({ status: "COMPLETED", orderID, captureID: captureId, orderNumber: localOrder.order_number, confirmationEmail: email.status });
  } catch (error) {
    console.error("capture-order:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "No se pudo registrar la confirmación del pago" }, { status: 500 });
  }
}
