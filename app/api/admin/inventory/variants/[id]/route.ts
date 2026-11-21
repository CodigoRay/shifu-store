import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const runtime = "nodejs";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ id: string }> };

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Falta configurar Supabase en el servidor.");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!isAdminAuthenticated(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Variante no válida." }, { status: 400 });
  try {
    const body = await request.json();
    const db = adminDb();

    if (body.action === "toggle_active") {
      if (typeof body.active !== "boolean") return NextResponse.json({ error: "Estado de variante no válido." }, { status: 400 });
      const { data, error } = await db.from("product_variants").update({ active: body.active, updated_at: new Date().toISOString() }).eq("id", id)
        .select("id,active").single();
      if (error || !data) return NextResponse.json({ error: "No se pudo actualizar la variante." }, { status: 409 });
      return NextResponse.json({ ok: true, variant: data });
    }

    if (body.action !== "adjust_stock") return NextResponse.json({ error: "Acción no permitida." }, { status: 400 });
    const delta = Number(body.delta);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 240) : "Ajuste manual";
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10000) return NextResponse.json({ error: "El ajuste debe ser un entero distinto de cero y no superar 10000 unidades." }, { status: 400 });

    const { data, error } = await db.rpc("adjust_variant_stock", {
      p_variant_id: id,
      p_delta: delta,
      p_reason: reason || "Ajuste manual",
      p_movement_type: delta > 0 ? "restock" : "adjustment",
    });
    if (error || !data) {
      const message = error?.message?.includes("STOCK_BELOW_RESERVED")
        ? "No puedes reducir el stock por debajo de las unidades reservadas en checkouts activos."
        : "No se pudo ajustar el inventario.";
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ ok: true, variant: data });
  } catch (error) {
    console.error("adjust inventory variant:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Error interno al actualizar la variante." }, { status: 500 });
  }
}
