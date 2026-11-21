import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAdminAuthenticated(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return NextResponse.json({ error: "Falta configurar Supabase en el servidor." }, { status: 500 });

  try {
    const db = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc("release_expired_inventory_reservations");
    if (error) {
      console.error("release expired reservations:", error.code);
      return NextResponse.json({ error: "No se pudieron liberar las reservas vencidas. Comprueba la migración de inventario." }, { status: 503 });
    }
    return NextResponse.json({ ok: true, releasedCount: Number(data ?? 0) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("release expired reservations:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Error interno al liberar reservas vencidas." }, { status: 500 });
  }
}
