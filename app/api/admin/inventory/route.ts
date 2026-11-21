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
    const { data: releasedCount, error: releaseError } = await db.rpc("release_expired_inventory_reservations");
    if (releaseError) return NextResponse.json({ error: "No está instalada la migración de inventario 004." }, { status: 503 });

    const [productsResult, variantsResult, movementsResult, reservationsResult] = await Promise.all([
      db.from("products").select("id,slug,name,category,price_usd,active").order("name", { ascending: true }),
      db.from("product_variants").select("id,product_id,sku,size,color,color_hex,price_adjustment,stock_on_hand,reserved_quantity,available_stock,active,created_at,updated_at").order("created_at", { ascending: true }),
      db.from("inventory_movements").select("id,variant_id,order_id,movement_type,quantity_delta,reserved_delta,stock_after,reserved_after,reason,created_at").order("created_at", { ascending: false }).limit(100),
      db.from("inventory_reservations").select("id,order_id,variant_id,quantity,status,expires_at,created_at").eq("status", "reserved").order("expires_at", { ascending: true }).limit(50),
    ]);

    if (productsResult.error || variantsResult.error || movementsResult.error || reservationsResult.error) {
      console.error("admin inventory query:", productsResult.error?.code, variantsResult.error?.code, movementsResult.error?.code, reservationsResult.error?.code);
      return NextResponse.json({ error: "No se pudo cargar el inventario y sus movimientos." }, { status: 500 });
    }

    const products = productsResult.data ?? [];
    const variants = variantsResult.data ?? [];
    const variantMap = new Map(variants.map((variant: any) => [variant.id, variant]));
    const productMap = new Map(products.map((product: any) => [product.id, product]));

    const movementRows = (movementsResult.data ?? []).map((movement: any) => {
      const variant: any = variantMap.get(movement.variant_id);
      const product: any = productMap.get(variant?.product_id);
      return {
        ...movement,
        sku: variant?.sku ?? "—",
        variant_label: [variant?.size, variant?.color].filter(Boolean).join(" · ") || variant?.sku || "—",
        product_name: product?.name ?? "Producto",
      };
    });

    const reservations = reservationsResult.data ?? [];
    const orderIds = Array.from(new Set(reservations.map((reservation: any) => reservation.order_id)));
    let orderMap = new Map<string, any>();
    if (orderIds.length > 0) {
      const { data: orders, error: ordersError } = await db.from("orders").select("id,order_number,payment_status").in("id", orderIds);
      if (ordersError) {
        console.error("admin inventory reservations orders:", ordersError.code);
        return NextResponse.json({ error: "No se pudo consultar el estado de los pedidos reservados." }, { status: 500 });
      }
      orderMap = new Map((orders ?? []).map((order: any) => [order.id, order]));
    }

    const reservationRows = reservations.map((reservation: any) => {
      const variant: any = variantMap.get(reservation.variant_id);
      const product: any = productMap.get(variant?.product_id);
      const order: any = orderMap.get(reservation.order_id);
      return {
        ...reservation,
        order_number: order?.order_number ?? null,
        payment_status: order?.payment_status ?? null,
        sku: variant?.sku ?? "—",
        variant_label: [variant?.size, variant?.color].filter(Boolean).join(" · ") || variant?.sku || "—",
        product_name: product?.name ?? "Producto",
      };
    });

    return NextResponse.json({
      products,
      variants,
      movements: movementRows,
      reservations: reservationRows,
      releasedExpiredCount: Number(releasedCount ?? 0),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("admin inventory:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Error interno al consultar el inventario." }, { status: 500 });
  }
}
