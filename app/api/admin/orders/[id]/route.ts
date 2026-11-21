import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { sendOrderEmailNotification } from "@/lib/order-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Falta configurar Supabase en el servidor.");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  if (!isAdminAuthenticated(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Pedido no válido." }, { status: 400 });
  try {
    const db = adminDb();
    const { data: order, error: orderError } = await db.from("orders").select("*").eq("id", id).single();
    if (orderError || !order) return NextResponse.json({ error: "No encontramos ese pedido." }, { status: 404 });
    const { data: items, error: itemsError } = await db
      .from("order_items")
      .select("product_id,product_name,quantity,unit_price,line_total,variant_sku,variant_size,variant_color,variant_label")
      .eq("order_id", id);
    if (itemsError) return NextResponse.json({ error: "No pudimos cargar los productos del pedido." }, { status: 500 });
    return NextResponse.json({ order, items: items ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("admin order detail:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Error interno al consultar el pedido." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!isAdminAuthenticated(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Pedido no válido." }, { status: 400 });

  let body: { fulfillmentStatus?: unknown; shippingCarrier?: unknown; trackingNumber?: unknown; trackingUrl?: unknown } = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 }); }

  const hasStatus = body.fulfillmentStatus !== undefined;
  const nextStatus = body.fulfillmentStatus;
  if (hasStatus && (typeof nextStatus !== "string" || !["preparing", "shipped", "delivered"].includes(nextStatus))) {
    return NextResponse.json({ error: "Estado de entrega no permitido." }, { status: 400 });
  }

  const carrier = body.shippingCarrier === undefined ? undefined : String(body.shippingCarrier).trim();
  const trackingNumber = body.trackingNumber === undefined ? undefined : String(body.trackingNumber).trim();
  const trackingUrl = body.trackingUrl === undefined ? undefined : String(body.trackingUrl).trim();
  if (carrier !== undefined && carrier.length > 100) return NextResponse.json({ error: "La transportadora es demasiado larga." }, { status: 400 });
  if (trackingNumber !== undefined && trackingNumber.length > 120) return NextResponse.json({ error: "El número de guía es demasiado largo." }, { status: 400 });
  if (trackingUrl !== undefined && trackingUrl.length > 500) return NextResponse.json({ error: "El enlace de rastreo es demasiado largo." }, { status: 400 });
  if (trackingUrl) {
    try {
      const parsed = new URL(trackingUrl);
      if (parsed.protocol !== "https:") throw new Error("https required");
    } catch {
      return NextResponse.json({ error: "El enlace de rastreo debe ser una URL HTTPS válida." }, { status: 400 });
    }
  }

  try {
    const db = adminDb();
    const { data: current, error: currentError } = await db.from("orders")
      .select("id,payment_status,fulfillment_status")
      .eq("id", id).single();
    if (currentError || !current) return NextResponse.json({ error: "No encontramos ese pedido." }, { status: 404 });
    if (current.payment_status !== "completed") return NextResponse.json({ error: "Solo puedes gestionar pedidos cuyo pago esté confirmado." }, { status: 409 });

    const update: Record<string, string | null> = {};
    if (carrier !== undefined) update.shipping_carrier = carrier || null;
    if (trackingNumber !== undefined) update.tracking_number = trackingNumber || null;
    if (trackingUrl !== undefined) update.tracking_url = trackingUrl || null;

    if (hasStatus) {
      const transitions: Record<string, string[]> = {
        pending: ["preparing"],
        preparing: ["shipped"],
        shipped: ["delivered"],
        delivered: [],
        awaiting_payment: [],
      };
      const allowed = transitions[String(current.fulfillment_status)] ?? [];
      if (!allowed.includes(nextStatus as string)) {
        return NextResponse.json({ error: "Ese cambio de estado no está permitido desde el estado actual." }, { status: 409 });
      }
      if (nextStatus === "shipped") {
        const finalCarrier = carrier ?? "";
        const finalTrackingNumber = trackingNumber ?? "";
        if (!finalCarrier || !finalTrackingNumber) {
          return NextResponse.json({ error: "Antes de marcar como enviado, introduce la transportadora y el número de guía." }, { status: 400 });
        }
        update.shipped_at = new Date().toISOString();
      }
      if (nextStatus === "delivered") update.delivered_at = new Date().toISOString();
      update.fulfillment_status = nextStatus as string;
    } else if (carrier === undefined && trackingNumber === undefined && trackingUrl === undefined) {
      return NextResponse.json({ error: "No hay datos para actualizar." }, { status: 400 });
    }

    const { data: updated, error: updateError } = await db
      .from("orders")
      .update(update)
      .eq("id", id)
      .select("id,fulfillment_status,shipping_carrier,tracking_number,tracking_url,shipped_at,delivered_at")
      .single();
    if (updateError || !updated) {
      console.error("admin order update:", updateError?.code);
      return NextResponse.json({ error: "No se pudo actualizar el pedido. Verifica que aplicaste la migración de seguimiento." }, { status: 409 });
    }
    let emailNotification: string | undefined;
    if (nextStatus === "shipped" || (!hasStatus && current.fulfillment_status === "shipped")) {
      const result = await sendOrderEmailNotification(db, id, "order_shipped");
      emailNotification = result.status;
    } else if (nextStatus === "delivered" || (!hasStatus && current.fulfillment_status === "delivered")) {
      const result = await sendOrderEmailNotification(db, id, "order_delivered");
      emailNotification = result.status;
    }
    return NextResponse.json({ ok: true, ...updated, emailNotification });
  } catch (error) {
    console.error("admin order update:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Error interno al actualizar el pedido." }, { status: 500 });
  }
}
