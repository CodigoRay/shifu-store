import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const runtime = "nodejs";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (value: unknown, max = 100) => typeof value === "string" ? value.trim().slice(0, max) : "";

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Falta configurar Supabase en el servidor.");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: NextRequest) {
  if (!isAdminAuthenticated(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  try {
    const body = await request.json();
    const productId = clean(body.productId, 50);
    const sku = clean(body.sku, 80).toUpperCase();
    const size = clean(body.size, 40) || null;
    const color = clean(body.color, 60) || null;
    const colorHex = clean(body.colorHex, 7) || null;
    const priceAdjustment = Number(body.priceAdjustment ?? 0);
    const initialStock = Number(body.initialStock ?? 0);

    if (!UUID_RE.test(productId)) return NextResponse.json({ error: "Producto no válido." }, { status: 400 });
    if (!/^[A-Z0-9][A-Z0-9._-]{1,79}$/.test(sku)) return NextResponse.json({ error: "El SKU debe tener entre 2 y 80 caracteres (letras, números, punto, guion o guion bajo)." }, { status: 400 });
    if (!size && !color) return NextResponse.json({ error: "Indica al menos una talla o un color." }, { status: 400 });
    if (colorHex && !/^#[0-9A-Fa-f]{6}$/.test(colorHex)) return NextResponse.json({ error: "El color hexadecimal debe tener formato #RRGGBB." }, { status: 400 });
    if (!Number.isFinite(priceAdjustment) || priceAdjustment < 0 || priceAdjustment > 100000) return NextResponse.json({ error: "El ajuste de precio no es válido." }, { status: 400 });
    if (!Number.isInteger(initialStock) || initialStock < 0 || initialStock > 10000) return NextResponse.json({ error: "El stock inicial debe ser un entero entre 0 y 10000." }, { status: 400 });

    const db = adminDb();
    const { data: product, error: productError } = await db.from("products").select("id").eq("id", productId).eq("active", true).maybeSingle();
    if (productError || !product) return NextResponse.json({ error: "El producto no existe o está inactivo." }, { status: 404 });

    const { data: variant, error: insertError } = await db.from("product_variants").insert({
      product_id: productId,
      sku,
      size,
      color,
      color_hex: colorHex,
      price_adjustment: priceAdjustment,
      stock_on_hand: 0,
      reserved_quantity: 0,
      active: true,
    }).select("id,product_id,sku,size,color,color_hex,price_adjustment,stock_on_hand,reserved_quantity,available_stock,active").single();

    if (insertError || !variant) {
      const code = insertError?.code;
      const message = code === "23505" ? "Ya existe una variante con ese SKU o esa combinación de talla y color." : "No se pudo crear la variante.";
      return NextResponse.json({ error: message }, { status: 409 });
    }

    if (initialStock > 0) {
      const { error: stockError } = await db.rpc("adjust_variant_stock", {
        p_variant_id: variant.id,
        p_delta: initialStock,
        p_reason: "Inventario inicial de variante",
        p_movement_type: "opening",
      });
      if (stockError) {
        await db.from("product_variants").delete().eq("id", variant.id);
        console.error("initial variant stock:", stockError.code);
        return NextResponse.json({ error: "La variante se creó, pero no se pudo registrar el inventario inicial. Vuelve a intentarlo." }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, variant }, { status: 201 });
  } catch (error) {
    console.error("create inventory variant:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Error interno al crear la variante." }, { status: 500 });
  }
}
