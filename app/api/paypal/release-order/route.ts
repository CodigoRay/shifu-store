import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Falta configurar SUPABASE_SECRET_KEY");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orderID = body?.orderID;
    if (typeof orderID !== "string" || !/^[A-Z0-9-]{1,100}$/i.test(orderID)) {
      return NextResponse.json({ error: "Orden no válida." }, { status: 400 });
    }
    const db = adminDb();
    const { data: order, error: lookupError } = await db.from("orders").select("id,payment_status").eq("paypal_order_id", orderID).maybeSingle();
    if (lookupError || !order) return NextResponse.json({ ok: true, released: 0 });
    if (order.payment_status === "completed") return NextResponse.json({ ok: true, released: 0 });
    const { data, error } = await db.rpc("release_order_inventory_reservation", { p_order_id: order.id });
    if (error) {
      console.error("release inventory reservation:", error.code);
      return NextResponse.json({ error: "No se pudo liberar la reserva. Se liberará automáticamente al vencer." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, released: Number(data ?? 0) });
  } catch (error) {
    console.error("release-order:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "No se pudo procesar la cancelación del checkout." }, { status: 500 });
  }
}
