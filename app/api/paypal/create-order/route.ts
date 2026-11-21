import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CartRequestItem = { variantId: string; quantity: number };
type VariantRow = {
  id: string; product_id: string; sku: string; size: string | null; color: string | null;
  price_adjustment: number | string; active: boolean; stock_on_hand: number; reserved_quantity: number;
};
type ProductRow = { id: string; name: string; price_usd: number | string; active: boolean };
type CheckoutRow = {
  variant_id: string; product_id: string; variant_sku: string; variant_size: string | null;
  variant_color: string | null; variant_label: string; product_name: string;
  quantity: number; unit_price: number; line_total: number;
};

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Falta configurar SUPABASE_SECRET_KEY en el servidor");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function paypalBaseUrl() {
  return process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function getAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Faltan credenciales privadas de PayPal");
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("No fue posible autenticar con PayPal");
  return (await response.json()).access_token as string;
}

const clean = (value: unknown, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
      return NextResponse.json({ error: "Carrito no válido" }, { status: 400 });
    }

    const customerInput = body.customer ?? {};
    const customer = {
      firstName: clean(customerInput.firstName, 80),
      lastName: clean(customerInput.lastName, 80),
      email: clean(customerInput.email, 254).toLowerCase(),
      phone: clean(customerInput.phone, 40),
      countryCode: clean(customerInput.countryCode, 2).toUpperCase(),
      countryName: clean(customerInput.countryName, 80),
      addressLine1: clean(customerInput.addressLine1, 180),
      addressLine2: clean(customerInput.addressLine2, 180),
      city: clean(customerInput.city, 100),
      stateRegion: clean(customerInput.stateRegion, 100),
      postalCode: clean(customerInput.postalCode, 30),
    };

    if (!customer.firstName || !customer.lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) || !customer.phone ||
      !/^[A-Z]{2}$/.test(customer.countryCode) || !customer.countryName || !customer.addressLine1 || !customer.city || !customer.postalCode) {
      return NextResponse.json({ error: "Completa nombre, correo, teléfono y dirección de entrega" }, { status: 400 });
    }

    const quantities = new Map<string, number>();
    for (const item of body.items as CartRequestItem[]) {
      if (!item || typeof item.variantId !== "string" || !UUID_RE.test(item.variantId) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
        return NextResponse.json({ error: "Selecciona una variante válida y una cantidad correcta" }, { status: 400 });
      }
      quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
    }
    if ([...quantities.values()].some((quantity) => quantity > 20)) {
      return NextResponse.json({ error: "Cantidad máxima excedida por variante" }, { status: 400 });
    }

    const db = adminDb();
    // Limpieza oportunista de reservas abandonadas que superaron los 30 minutos.
    const { error: sweepError } = await db.rpc("release_expired_inventory_reservations");
    if (sweepError) {
      console.error("inventory expiry sweep:", sweepError.code);
      return NextResponse.json({ error: "El inventario aún no está preparado. Verifica que ejecutaste la migración 004." }, { status: 503 });
    }

    const variantIds = [...quantities.keys()];
    const { data: variants, error: variantsError } = await db.from("product_variants")
      .select("id,product_id,sku,size,color,price_adjustment,active,stock_on_hand,reserved_quantity")
      .in("id", variantIds).eq("active", true);
    if (variantsError || !variants || variants.length !== variantIds.length) {
      return NextResponse.json({ error: "Una de las tallas o colores seleccionados ya no está disponible. Actualiza el catálogo." }, { status: 409 });
    }

    const productIds = [...new Set((variants as VariantRow[]).map((variant) => variant.product_id))];
    const { data: products, error: productsError } = await db.from("products")
      .select("id,name,price_usd,active").in("id", productIds).eq("active", true);
    if (productsError || !products || products.length !== productIds.length) {
      return NextResponse.json({ error: "No se pudieron validar los productos del carrito" }, { status: 409 });
    }

    const productMap = new Map((products as ProductRow[]).map((product) => [product.id, product]));
    const variantMap = new Map((variants as VariantRow[]).map((variant) => [variant.id, variant]));
    const rows: CheckoutRow[] = variantIds.map((variantId) => {
      const variant = variantMap.get(variantId)!;
      const product = productMap.get(variant.product_id)!;
      const quantity = quantities.get(variantId)!;
      const unitPrice = Math.round((Number(product.price_usd) + Number(variant.price_adjustment || 0)) * 100) / 100;
      const label = [variant.size, variant.color].filter(Boolean).join(" · ") || variant.sku;
      return {
        variant_id: variant.id,
        product_id: product.id,
        variant_sku: variant.sku,
        variant_size: variant.size,
        variant_color: variant.color,
        variant_label: label,
        product_name: product.name,
        quantity,
        unit_price: unitPrice,
        line_total: Math.round(unitPrice * 100) / 100 * quantity,
      };
    });

    for (const row of rows) {
      const variant = variantMap.get(row.variant_id)!;
      const available = Number(variant.stock_on_hand) - Number(variant.reserved_quantity);
      if (available < row.quantity) {
        return NextResponse.json({ error: `Existencias insuficientes para ${row.product_name} (${row.variant_label}). Disponibles: ${Math.max(available, 0)}.` }, { status: 409 });
      }
      if (!Number.isFinite(row.unit_price) || row.unit_price <= 0) {
        return NextResponse.json({ error: "El precio de una variante no es válido" }, { status: 409 });
      }
    }

    const cents = rows.reduce((sum, row) => sum + Math.round(row.unit_price * 100) * row.quantity, 0);
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1000000) {
      return NextResponse.json({ error: "Total no válido" }, { status: 400 });
    }
    const total = (cents / 100).toFixed(2);

    const token = await getAccessToken();
    const paypalResponse = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": crypto.randomUUID(),
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          custom_id: "shifu-store",
          description: "Compra en Shifu Store",
          amount: { currency_code: "USD", value: total, breakdown: { item_total: { currency_code: "USD", value: total } } },
          items: rows.map((row) => ({
            name: `${row.product_name} - ${row.variant_label}`.slice(0, 127),
            sku: row.variant_sku,
            unit_amount: { currency_code: "USD", value: row.unit_price.toFixed(2) },
            quantity: String(row.quantity),
          })),
        }],
      }),
      cache: "no-store",
    });
    const paypal = await paypalResponse.json();
    if (!paypalResponse.ok || typeof paypal.id !== "string") {
      return NextResponse.json({ error: "PayPal no pudo crear la orden" }, { status: 502 });
    }

    const { data: order, error: orderError } = await db.from("orders").insert({
      guest_email: customer.email,
      customer_first_name: customer.firstName,
      customer_last_name: customer.lastName,
      customer_phone: customer.phone,
      currency: "USD",
      subtotal: total,
      discount_amount: 0,
      shipping_amount: 0,
      tax_amount: 0,
      total,
      shipping_recipient: `${customer.firstName} ${customer.lastName}`,
      shipping_phone: customer.phone,
      shipping_country_code: customer.countryCode,
      shipping_country_name: customer.countryName,
      shipping_address_line1: customer.addressLine1,
      shipping_address_line2: customer.addressLine2 || null,
      shipping_city: customer.city,
      shipping_state_region: customer.stateRegion || null,
      shipping_postal_code: customer.postalCode,
      paypal_order_id: paypal.id,
      status: "pending_payment",
      payment_status: "pending",
    }).select("id,order_number").single();

    if (orderError || !order) {
      console.error("No se pudo guardar pedido", orderError?.code);
      return NextResponse.json({ error: "PayPal creó la orden, pero no pudimos registrar el pedido. No completes otro pago; contacta con soporte." }, { status: 500 });
    }

    const itemRows = rows.map((row) => ({
      order_id: order.id,
      product_id: row.product_id,
      product_name: row.product_name,
      quantity: row.quantity,
      unit_price: row.unit_price,
      line_total: row.line_total,
      variant_id: row.variant_id,
      variant_sku: row.variant_sku,
      variant_size: row.variant_size,
      variant_color: row.variant_color,
      variant_label: row.variant_label,
    }));
    const { error: itemsError } = await db.from("order_items").insert(itemRows);
    if (itemsError) {
      await db.from("orders").update({ status: "cancelled" }).eq("id", order.id);
      console.error("No se pudieron guardar líneas del pedido", itemsError.code);
      return NextResponse.json({ error: "No pudimos registrar las variantes del pedido" }, { status: 500 });
    }

    const { error: reserveError } = await db.rpc("reserve_order_inventory", {
      p_order_id: order.id,
      p_items: rows.map((row) => ({ variant_id: row.variant_id, quantity: row.quantity })),
    });
    if (reserveError) {
      await db.from("orders").update({ status: "cancelled" }).eq("id", order.id);
      console.error("No se pudo reservar inventario", reserveError.code, reserveError.message);
      return NextResponse.json({ error: "Una o más variantes se agotaron mientras se procesaba el carrito. Actualiza la página y vuelve a intentarlo." }, { status: 409 });
    }

    await db.from("order_events").insert({ order_id: order.id, event_type: "order_created", description: "Pedido creado y existencias reservadas durante 30 minutos; pago pendiente de confirmación." });
    return NextResponse.json({ id: paypal.id, orderNumber: order.order_number, amount: total, currency: "USD" });
  } catch (error) {
    console.error("create-order:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "No se pudo iniciar el pedido. Comprueba la configuración del servidor." }, { status: 500 });
  }
}
