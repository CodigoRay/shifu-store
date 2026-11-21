import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Falta configurar Supabase en el servidor.");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: NextRequest) {
  let body: { orderNumber?: unknown; email?: unknown } = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Completa los datos del pedido." }, { status: 400 }); }
  const orderNumber = typeof body.orderNumber === "string" ? body.orderNumber.trim().toUpperCase() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^SHF-[A-Z0-9-]{4,24}$/.test(orderNumber) || email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "No encontramos un pedido con esos datos. Revisa el número y el correo." }, { status: 400 });
  }

  try {
    const db = adminDb();
    const { data: order, error } = await db.from("orders")
      .select("id,order_number,guest_email,payment_status,fulfillment_status,created_at,paid_at,shipped_at,delivered_at,shipping_carrier,tracking_number,tracking_url")
      .eq("order_number", orderNumber).maybeSingle();
    if (error) {
      console.error("public tracking lookup:", error.code);
      return NextResponse.json({ error: "No fue posible consultar el pedido ahora. Inténtalo de nuevo." }, { status: 500 });
    }
    if (!order || String(order.guest_email ?? "").trim().toLowerCase() !== email) {
      return NextResponse.json({ error: "No encontramos un pedido con esos datos. Revisa el número y el correo." }, { status: 404 });
    }
    const { data: items, error: itemsError } = await db.from("order_items")
      .select("product_name,quantity")
      .eq("order_id", order.id);
    if (itemsError) return NextResponse.json({ error: "No fue posible cargar el detalle del pedido." }, { status: 500 });

    const safeTrackingUrl = typeof order.tracking_url === "string" && order.tracking_url.startsWith("https://") ? order.tracking_url : null;
    return NextResponse.json({
      order: {
        orderNumber: order.order_number,
        paymentStatus: order.payment_status,
        fulfillmentStatus: order.fulfillment_status,
        createdAt: order.created_at,
        paidAt: order.paid_at,
        shippedAt: order.shipped_at,
        deliveredAt: order.delivered_at,
        shippingCarrier: order.shipping_carrier,
        trackingNumber: order.tracking_number,
        trackingUrl: safeTrackingUrl,
      },
      items: (items ?? []).map(item => ({ productName: item.product_name, quantity: item.quantity })),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("public tracking:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Error interno al consultar el pedido." }, { status: 500 });
  }
}
