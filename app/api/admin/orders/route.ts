import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Falta configurar Supabase en el servidor.");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(request: NextRequest) {
  if (!isAdminAuthenticated(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  try {
    const db = adminDb();
    const { data, error } = await db
      .from("orders")
      .select("id,order_number,guest_email,customer_first_name,customer_last_name,customer_phone,currency,subtotal,discount_amount,shipping_amount,tax_amount,total,status,payment_status,fulfillment_status,paid_at,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("admin orders list:", error.code);
      return NextResponse.json({ error: "No se pudieron cargar los pedidos. Verifica que aplicaste la migración del panel." }, { status: 500 });
    }
    return NextResponse.json({ orders: data ?? [] });
  } catch (error) {
    console.error("admin orders list:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Error interno al consultar los pedidos." }, { status: 500 });
  }
}
