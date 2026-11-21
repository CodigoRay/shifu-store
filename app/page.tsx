
"use client";

import { useEffect, useState } from "react";
import PayPalButtons from "./components/PayPalButtons";
import { createClient } from "@/lib/supabase/client";

type Currency = "USD" | "COP" | "MXN";
type Cart = Record<string, number>;
type ProductVariant = {
  id: string;
  product_id: string;
  sku: string;
  size: string | null;
  color: string | null;
  color_hex: string | null;
  price_adjustment: number | string;
  available_stock: number;
};
type CartLine = { product: Product; variant: ProductVariant; quantity: number };
type CheckoutCustomer = { firstName:string; lastName:string; email:string; phone:string; countryCode:string; countryName:string; addressLine1:string; addressLine2:string; city:string; stateRegion:string; postalCode:string };

type Product = {
  id: string;
  slug: string;
  name: string;
  category: string;
  priceUSD: number;
  imageUrl: string | null;
  color: "black" | "cream" | "gray";
  label: string;
  artwork: string;
  variants: ProductVariant[];
};

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  price_usd: number | string;
  image_url: string | null;
  active: boolean;
};

const productPresentation: Record<string, Pick<Product, "color" | "label" | "artwork">> = {
  "camiseta-dojo-oversize": { color: "black", label: "NUEVO", artwork: "DOJO" },
  "camiseta-horizonte": { color: "cream", label: "DESTACADO", artwork: "SHIFU" },
  "gorra-shifu-club": { color: "black", label: "MÁS VENDIDO", artwork: "✳" },
  "hoodie-esencia": { color: "gray", label: "EDICIÓN LIMITADA", artwork: "SC" },
};

const CART_STORAGE_KEY = "shifu-store-cart-v3-variants";

const rates: Record<Currency, number> = {
  USD: 1,
  COP: 4000,
  MXN: 17,
};

const categories = [
  {
    name: "CAMISETAS",
    description: "Diseños para todos los días",
    symbol: "01",
  },
  {
    name: "GORRAS",
    description: "El sello de la comunidad",
    symbol: "02",
  },
  {
    name: "HOODIES",
    description: "Comodidad con actitud",
    symbol: "03",
  },
  {
    name: "ACCESORIOS",
    description: "Los detalles cuentan",
    symbol: "04",
  },
];

function formatMoney(priceUSD: number, currency: Currency): string {
  const amount = priceUSD * rates[currency];

  return new Intl.NumberFormat(
    currency === "USD" ? "en-US" : currency === "COP" ? "es-CO" : "es-MX",
    {
      style: "currency",
      currency,
      minimumFractionDigits: currency === "USD" ? 2 : 0,
      maximumFractionDigits: currency === "USD" ? 2 : 0,
    },
  ).format(amount);
}

function Garment({ product }: { product: Product }) {
  const isCap = product.category === "GORRAS";
  const isHoodie = product.category === "HOODIES";

  const garment =
    product.color === "cream"
      ? "bg-[#f4eee3] text-[#191919]"
      : product.color === "gray"
        ? "bg-[#292929] text-white"
        : "bg-[#141414] text-white";

  return (
    <div
      className={`relative flex aspect-[4/5] items-center justify-center overflow-hidden ${
        product.color === "cream"
          ? "bg-[#e9e3d9]"
          : product.color === "gray"
            ? "bg-[#d9d8d6]"
            : "bg-[#e8e7e5]"
      }`}
    >
      <span className="absolute left-3 top-3 z-10 bg-[#d8c4ff] px-2 py-1 text-[9px] font-bold tracking-wider">
        {product.label}
      </span>

      <span
        aria-hidden="true"
        className="absolute right-3 top-3 text-lg text-black/60"
      >
        ♡
      </span>

      <div className="transition-transform duration-300 group-hover:scale-105">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className={`relative flex items-center justify-center shadow-xl ${
              isCap
                ? "h-20 w-32 rounded-t-[55%] rounded-b-xl md:h-24 md:w-40"
                : isHoodie
                  ? "h-44 w-36 rounded-2xl md:h-56 md:w-44"
                  : "h-40 w-32 rounded-sm md:h-52 md:w-40"
            } ${garment}`}
          >
            {!isCap && (
              <div
                aria-hidden="true"
                className="absolute left-0 top-5 h-14 w-5 -translate-x-2 rotate-12 rounded-sm bg-inherit md:h-20 md:w-7"
              />
            )}

            <div className="relative z-10 text-center">
              <span className="block text-2xl font-black tracking-widest md:text-3xl">✳</span>
              {!isCap && (
                <span className="mt-1 block text-[9px] font-black tracking-[0.2em] md:text-xs">
                  {product.artwork}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [currency, setCurrency] = useState<Currency>("USD");
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");
  const [selectedVariantByProduct, setSelectedVariantByProduct] = useState<Record<string, string>>({});
  const [cart, setCart] = useState<Cart>({});
  const [cartLoaded, setCartLoaded] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [addedMessage, setAddedMessage] = useState("");
  const [addedProductId, setAddedProductId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CheckoutCustomer>({ firstName:"", lastName:"", email:"", phone:"", countryCode:"CO", countryName:"Colombia", addressLine1:"", addressLine2:"", city:"", stateRegion:"", postalCode:"" });
  const [completedOrder, setCompletedOrder] = useState<{orderNumber:string; orderID:string}|null>(null);

  // Load the real active catalog from Supabase.
  useEffect(() => {
    let mounted = true;

    async function loadProducts() {
      try {
        const supabase = createClient();
        const [{ data, error }, { data: variantData, error: variantError }] = await Promise.all([
          supabase.from("products")
            .select("id, slug, name, category, price_usd, image_url, active")
            .eq("active", true)
            .order("created_at", { ascending: true }),
          supabase.from("active_product_variants")
            .select("id, product_id, sku, size, color, color_hex, price_adjustment, available_stock, active, created_at")
            .eq("active", true)
            .order("created_at", { ascending: true }),
        ]);

        if (error) throw error;
        if (variantError) throw new Error("No se pudo cargar el inventario. Ejecuta la migración 004-product-variants-inventory.sql en Supabase.");
        if (!mounted) return;

        const variants = (variantData ?? []) as ProductVariant[];
        const rows = (data ?? []) as ProductRow[];
        const mapped: Product[] = rows.map((row) => {
          const presentation = productPresentation[row.slug] ?? {
            color: "black" as const,
            label: "SHIFU CLUB",
            artwork: "SHIFU",
          };

          return {
            id: row.id,
            slug: row.slug,
            name: row.name,
            category: (row.category ?? "ACCESORIOS").toUpperCase(),
            priceUSD: Number(row.price_usd),
            imageUrl: row.image_url,
            variants: variants.filter((variant) => variant.product_id === row.id),
            ...presentation,
          };
        });

        setProducts(mapped);
        setSelectedVariantByProduct(Object.fromEntries(mapped.map((product) => {
          const preferred = product.variants.find((variant) => variant.available_stock > 0) ?? product.variants[0];
          return [product.id, preferred?.id ?? ""];
        })));
        setProductsError("");
      } catch (error) {
        console.error("Error cargando catálogo de Supabase:", error);
        if (mounted) setProductsError("No pudimos cargar los productos. Comprueba la conexión con Supabase e inténtalo de nuevo.");
      } finally {
        if (mounted) setProductsLoading(false);
      }
    }

    void loadProducts();
    return () => { mounted = false; };
  }, []);

  // Restore the cart after refresh. Cart values are only a convenience;
  // the server independently validates products and prices at checkout.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CART_STORAGE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const validEntries = Object.entries(parsed as Record<string, unknown>)
            .filter(([, quantity]) => Number.isInteger(quantity) && Number(quantity) > 0 && Number(quantity) <= 20);
          setCart(Object.fromEntries(validEntries) as Cart);
        }
      }
    } catch (error) {
      console.warn("No se pudo recuperar el carrito guardado.", error);
    } finally {
      setCartLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (cartLoaded) {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    }
  }, [cart, cartLoaded]);

  const cartCount = Object.values(cart).reduce((total, quantity) => total + quantity, 0);
  const cartItems: CartLine[] = products.flatMap((product) => product.variants
    .filter((variant) => (cart[variant.id] ?? 0) > 0)
    .map((variant) => ({ product, variant, quantity: cart[variant.id] ?? 0 })));
  const cartTotalUSD = cartItems.reduce(
    (total, line) => total + (line.product.priceUSD + Number(line.variant.price_adjustment || 0)) * line.quantity,
    0,
  );

  useEffect(() => {
    if (cartCount === 0) setCheckoutOpen(false);
  }, [cartCount]);

  function addToCart(productId: string, variantId: string) {
    const product = products.find((item) => item.id === productId);
    const variant = product?.variants.find((item) => item.id === variantId);
    if (!product || !variant) {
      setAddedMessage("Selecciona una talla y un color disponibles.");
      return;
    }
    const currentQuantity = cart[variantId] ?? 0;
    if (currentQuantity >= variant.available_stock) {
      setAddedMessage("No hay más unidades disponibles de esta variante.");
      window.setTimeout(() => setAddedMessage(""), 2500);
      return;
    }
    setCart((current) => ({ ...current, [variantId]: Math.min((current[variantId] ?? 0) + 1, 20) }));
    setAddedProductId(productId);
    const variantLabel = [variant.size, variant.color].filter(Boolean).join(" · ") || variant.sku;
    setAddedMessage(`${product.name} (${variantLabel}) añadido al carrito`);
    window.setTimeout(() => {
      setAddedProductId((current) => current === productId ? null : current);
      setAddedMessage("");
    }, 2200);
  }

  function changeQuantity(variantId: string, change: number) {
    const variant = products.flatMap((product) => product.variants).find((item) => item.id === variantId);
    const nextQuantity = (cart[variantId] ?? 0) + change;
    if (change > 0 && variant && nextQuantity > variant.available_stock) {
      setAddedMessage("Has alcanzado las existencias disponibles de esta variante.");
      window.setTimeout(() => setAddedMessage(""), 2500);
      return;
    }
    setCart((current) => {
      const next = { ...current };
      if (nextQuantity <= 0) delete next[variantId];
      else next[variantId] = nextQuantity;
      return next;
    });
  }

  function removeFromCart(variantId: string) {
    setCart((current) => {
      const next = { ...current };
      delete next[variantId];
      return next;
    });
  }

  return (
    <main className="min-h-screen bg-[#faf9f6] text-[#171717]">
      {/* Barra superior */}
      <div className="bg-[#d8c4ff] px-4 py-2 text-center text-[9px] font-bold tracking-[0.16em] md:text-[10px] md:tracking-[0.2em]">
        FANS PARA FANS · NUEVA COLECCIÓN · ENVÍOS INTERNACIONALES
      </div>

      {/* Navegación */}
      <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-4 border-b border-black/10 bg-[#faf9f6] px-5 py-5 md:px-10">
        <a href="#inicio" className="text-xl font-black tracking-tight md:text-2xl">
          SHIFU<span className="font-light"> CLUB ✳</span>
        </a>

        <nav
          aria-label="Navegación principal"
          className="order-3 flex w-full flex-wrap gap-x-5 gap-y-3 text-[10px] font-semibold tracking-[0.12em] md:order-none md:w-auto md:gap-6"
        >
          <a href="#inicio" className="hover:text-[#7555b5]">INICIO</a>
          <a href="#coleccion" className="hover:text-[#7555b5]">COLECCIONES</a>
          <a href="#productos" className="hover:text-[#7555b5]">PRODUCTOS</a>
          <a href="#fans" className="hover:text-[#7555b5]">FANS PARA FANS</a>
        </nav>

        <div className="ml-auto flex items-center gap-3 md:ml-0">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="relative flex items-center gap-2 text-xs font-bold"
            aria-label={`Abrir carrito, ${cartCount} productos`}
          >
            <span aria-hidden="true" className="text-xl">🛍</span>
            <span className="hidden sm:inline">CARRITO</span>
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#d8c4ff] px-1 text-[10px] font-black">
              {cartCount}
            </span>
          </button>
          <label className="flex items-center gap-2 border-l border-black/15 pl-4 text-xs">
          <span className="sr-only">Seleccionar moneda</span>
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
            className="max-w-24 bg-transparent py-2 font-semibold outline-none"
            aria-label="Seleccionar moneda"
          >
            <option value="USD">USD $</option>
            <option value="COP">COP $</option>
            <option value="MXN">MXN $</option>
          </select>
          </label>
        </div>
      </header>

      {/* Portada editorial */}
      <section
        id="inicio"
        className="relative isolate flex min-h-[490px] items-center overflow-hidden bg-[#373430] px-6 py-16 text-white md:min-h-[510px] md:px-16"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20 bg-[radial-gradient(ellipse_at_75%_45%,#81776d_0%,#514b45_38%,#292725_85%)]"
        />

        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-r from-black/65 via-black/25 to-transparent"
        />

        <div className="absolute right-[8%] top-[15%] -z-10 hidden h-80 w-80 rounded-full border border-white/10 md:block" />

        <div className="relative max-w-2xl">
          <p className="mb-5 text-[10px] tracking-[0.38em] text-white/80 md:text-xs">
            SHIFU CLUB · OFFICIAL MERCH
          </p>

          <h1 className="max-w-2xl text-5xl font-black leading-[0.98] tracking-tight md:text-7xl">
            FANS PARA FANS.
            <br />
            MÁS QUE MERCH.
            <br />
            ES COMUNIDAD.
          </h1>

          <p className="mt-6 max-w-md text-sm leading-6 text-white/80 md:text-base">
            Prendas para quienes viven el stream, comparten la disciplina y
            sienten que forman parte del mismo dojo.
          </p>

          <a
            href="#productos"
            className="mt-8 inline-flex bg-white px-7 py-4 text-[10px] font-bold tracking-[0.16em] text-black transition hover:bg-[#d8c4ff]"
          >
            EXPLORAR COLECCIÓN →
          </a>

          <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-[10px] font-medium text-white/90">
            <span>✳ COMUNIDAD</span>
            <span>✳ EDICIONES ESPECIALES</span>
            <span>✳ IDENTIDAD SHIFU</span>
          </div>
        </div>

        <div className="absolute bottom-7 right-7 hidden text-right text-[10px] leading-5 tracking-[0.18em] text-white/75 lg:block">
          DISCIPLINA
          <br />
          STREAMS
          <br />
          COMUNIDAD
          <br />
          SIEMPRE JUNTOS
        </div>
      </section>

      {/* Categorías */}
      <section id="coleccion" className="px-5 py-3 md:px-10 md:py-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {categories.map((category, index) => (
            <a
              href="#productos"
              key={category.symbol}
              className={`group relative flex min-h-32 items-end overflow-hidden p-4 text-white md:min-h-28 md:p-5 ${
                index % 2 === 0 ? "bg-[#45413d]" : "bg-[#252525]"
              }`}
            >
              <span className="absolute right-2 top-0 text-7xl font-black text-white/[0.06] md:text-8xl">
                {category.symbol}
              </span>

              <div className="relative">
                <h2 className="text-xs font-black tracking-wider md:text-sm">
                  {category.name} →
                </h2>
                <p className="mt-1 text-[10px] text-white/70">
                  {category.description}
                </p>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Productos */}
      <section id="productos" className="px-5 pb-16 pt-8 md:px-10 md:pt-10">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <p className="mb-2 text-[10px] font-bold tracking-[0.28em] text-[#7555b5]">
              DROP 001
            </p>
            <h2 className="text-2xl font-black tracking-tight md:text-3xl">
              PRODUCTOS DESTACADOS
            </h2>
          </div>

          <a
            href="#productos"
            className="shrink-0 text-[9px] font-semibold tracking-wider md:text-[10px]"
          >
            VER TODOS →
          </a>
        </div>

        {productsLoading && (
          <p className="mb-5 text-sm text-black/60">Cargando colección desde Shifu Store…</p>
        )}
        {productsError && (
          <div role="alert" className="mb-5 border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {productsError}
          </div>
        )}
        {!productsLoading && !productsError && products.length === 0 && (
          <p className="mb-5 text-sm text-black/60">Todavía no hay productos activos en el catálogo.</p>
        )}
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 md:gap-x-5 lg:grid-cols-4">
          {products.map((product) => (
            <article key={product.id} className="group min-w-0">
              <Garment product={product} />

              <div className="flex items-start justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-semibold tracking-[0.12em] text-black/50">
                    {product.category}
                  </p>

                  <h3 className="mt-1 text-xs font-bold md:text-sm">
                    {product.name}
                  </h3>

                  <p className="mt-2 text-sm font-bold">
                    {formatMoney(product.priceUSD + Number(product.variants.find((variant) => variant.id === (selectedVariantByProduct[product.id] ?? product.variants.find((item) => item.available_stock > 0)?.id))?.price_adjustment || 0), currency)}
                  </p>

                  <p className="mt-1 text-[9px] text-black/50">
                    Precio base: {formatMoney(product.priceUSD, "USD")}
                  </p>

                  <div className="mt-3 flex gap-2">
                    <span className="h-3 w-3 rounded-full bg-[#171717]" />
                    <span className="h-3 w-3 rounded-full border border-black/10 bg-[#e8e0d3]" />
                    <span className="h-3 w-3 rounded-full bg-[#cdb7f6]" />
                  </div>
                </div>

                <span
                  aria-hidden="true"
                  className="mt-5 text-lg transition group-hover:text-[#7555b5]"
                >
                  ↗
                </span>
              </div>
              <div className="mb-2">
                <label className="mb-1 block text-[9px] font-bold tracking-wider text-black/55">TALLA / COLOR</label>
                <select
                  value={selectedVariantByProduct[product.id] ?? product.variants.find((variant) => variant.available_stock > 0)?.id ?? ""}
                  onChange={(event) => setSelectedVariantByProduct((current) => ({ ...current, [product.id]: event.target.value }))}
                  disabled={product.variants.length === 0}
                  className="w-full border border-black/15 bg-white px-3 py-2 text-[11px] outline-none focus:border-[#7555b5] disabled:bg-black/5"
                >
                  {product.variants.length === 0 ? <option value="">Inventario por configurar</option> : product.variants.map((variant) => {
                    const label = [variant.size, variant.color].filter(Boolean).join(" · ") || variant.sku;
                    return <option key={variant.id} value={variant.id} disabled={variant.available_stock <= 0}>{label} — {variant.available_stock > 0 ? `${variant.available_stock} disponibles` : "Agotado"}</option>;
                  })}
                </select>
              </div>
              <button
                type="button"
                onClick={() => addToCart(product.id, selectedVariantByProduct[product.id] ?? product.variants.find((variant) => variant.available_stock > 0)?.id ?? "")}
                disabled={product.variants.length === 0 || product.variants.every((variant) => variant.available_stock <= 0)}
                aria-live="polite"
                className={`mt-1 flex w-full items-center justify-center gap-2 px-3 py-3 text-[10px] font-bold tracking-[0.12em] text-white transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-black/30 ${
                  addedProductId === product.id
                    ? "bg-[#7555b5] scale-[1.02]"
                    : "bg-[#171717] hover:bg-[#7555b5]"
                }`}
              >
                {addedProductId === product.id ? (
                  <><span className="inline-flex h-4 w-4 animate-bounce items-center justify-center rounded-full bg-white text-[#7555b5]">✓</span> AÑADIDO AL CARRITO</>
                ) : (
                  <>AÑADIR AL CARRITO <span aria-hidden="true">+</span></>
                )}
              </button>
            </article>
          ))}
        </div>

        <p className="mt-6 text-[10px] leading-5 text-black/50">
          Las variantes, tallas, colores y existencias se administran desde el panel de inventario. Las conversiones a COP y MXN son estimadas y utilizan tasas de prueba.
        </p>
      </section>

      {addedMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center gap-3 border border-white/10 bg-[#191919] px-4 py-4 text-white shadow-2xl animate-[toastIn_220ms_ease-out]"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d8c4ff] text-lg font-black text-[#171717]">✓</span>
          <span className="min-w-0 flex-1 text-sm font-semibold">{addedMessage}</span>
          <button type="button" onClick={() => setAddedMessage("")} aria-label="Cerrar aviso" className="px-1 text-xl text-white/70 hover:text-white">×</button>
          <style jsx>{`@keyframes toastIn { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }`}</style>
        </div>
      )}

      {/* Mensaje de comunidad */}
      <section
        id="fans"
        className="bg-[#eae5df] px-6 py-16 text-center md:py-24"
      >
        <p className="mb-4 text-[10px] font-bold tracking-[0.35em] text-[#7555b5]">
          UNA TIENDA HECHA CON LA COMUNIDAD
        </p>

        <h2 className="text-4xl font-black tracking-tight md:text-6xl">
          DE FANS.
          <br />
          PARA FANS.
        </h2>

        <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-black/65">
          Shifu Store nace de la pasión por el stream y de una comunidad que
          comparte algo más que una pantalla. Esto también es parte del dojo.
        </p>

        <a
          href="#productos"
          className="mt-7 inline-block bg-black px-7 py-4 text-[10px] font-bold tracking-[0.15em] text-white transition hover:bg-[#7555b5]"
        >
          DESCUBRIR EL DROP 001 →
        </a>
      </section>

      {/* Footer */}
      <footer className="bg-[#191919] px-6 py-10 text-white md:px-10">
        <div className="flex flex-col justify-between gap-6 md:flex-row">
          <div>
            <p className="text-xl font-black">
              SHIFU<span className="font-light"> CLUB ✳</span>
            </p>
            <p className="mt-2 text-xs text-white/60">
              Fans para fans. Una comunidad, una identidad.
            </p>
          </div>

          <div className="text-xs leading-6 text-white/60">
            <p>USD · COP · MXN</p>
            <p>Shifu Store · 2026</p>
            <p>Todos los derechos reservados.</p>
          </div>
        </div>
      </footer>

      {cartCount > 0 && !cartOpen && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          aria-label={`Abrir carrito con ${cartCount} productos`}
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#171717] text-white shadow-xl transition hover:scale-105 hover:bg-[#7555b5] focus:outline-none focus:ring-2 focus:ring-[#7555b5] focus:ring-offset-2"
        >
          <span aria-hidden="true" className="text-2xl">🛍</span>
          <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#d8c4ff] px-1 text-xs font-black text-[#171717]">
            {cartCount}
          </span>
        </button>
      )}

      {completedOrder && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="purchase-success-title" className="w-full max-w-md bg-[#faf9f6] p-7 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#d8c4ff] text-3xl">✓</div>
            <p className="mt-5 text-[10px] font-bold tracking-[0.25em] text-[#7555b5]">SHIFU CLUB</p>
            <h2 id="purchase-success-title" className="mt-2 text-2xl font-black">¡Gracias por tu compra!</h2>
            <p className="mt-3 text-sm text-black/60">Tu pago fue confirmado y tu pedido quedó registrado.</p>
            <div className="mt-6 border border-black/10 bg-white p-4">
              <p className="text-[10px] font-bold tracking-widest text-black/50">NÚMERO DE PEDIDO</p>
              <p className="mt-2 text-2xl font-black">{completedOrder.orderNumber}</p>
              <p className="mt-2 break-all text-[10px] text-black/40">Referencia PayPal: {completedOrder.orderID}</p>
            </div>
            <p className="mt-4 text-xs leading-5 text-black/60">Guarda tu número de pedido. El historial de compras y el seguimiento del cliente se habilitarán en la siguiente etapa.</p>
            <button onClick={()=>setCompletedOrder(null)} className="mt-6 w-full bg-black px-5 py-3 text-[10px] font-bold tracking-widest text-white">CONTINUAR COMPRANDO</button>
          </section>
        </div>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Cerrar carrito"
            onClick={() => { setCartOpen(false); setCheckoutOpen(false); }}
            className="absolute inset-0 bg-black/50"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-title"
            className="relative z-10 flex h-full w-full max-w-md flex-col bg-[#faf9f6] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-black/10 px-5 py-5">
              <div>
                <p className="text-[9px] font-bold tracking-[0.25em] text-[#7555b5]">SHIFU CLUB</p>
                <h2 id="cart-title" className="mt-1 text-xl font-black">TU CARRITO ({cartCount})</h2>
              </div>
              <button
                type="button"
                onClick={() => { setCartOpen(false); setCheckoutOpen(false); }}
                className="p-2 text-2xl leading-none"
                aria-label="Cerrar carrito"
              >
                ×
              </button>
            </div>

            {cartItems.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
                <span className="text-5xl" aria-hidden="true">🛍</span>
                <h3 className="mt-5 text-lg font-black">Tu carrito está vacío</h3>
                <p className="mt-2 text-sm text-black/60">Descubre la colección y añade tus favoritos.</p>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  className="mt-6 bg-black px-6 py-3 text-[10px] font-bold tracking-wider text-white"
                >
                  SEGUIR COMPRANDO
                </button>
              </div>
            ) : (
              <>
                <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                  {cartItems.map((line) => {
                    const variantLabel = [line.variant.size, line.variant.color].filter(Boolean).join(" · ") || line.variant.sku;
                    const unitPrice = line.product.priceUSD + Number(line.variant.price_adjustment || 0);
                    return (
                      <article key={line.variant.id} className="flex gap-4 border-b border-black/10 pb-4">
                        <div className={`flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden ${
                          line.product.color === "cream" ? "bg-[#e9e3d9] text-black" : line.product.color === "gray" ? "bg-[#292929] text-white" : "bg-[#141414] text-white"
                        }`}>
                          {line.product.imageUrl ? (
                            <img src={line.product.imageUrl} alt={line.product.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-center text-xs font-black tracking-widest">{line.product.artwork}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-bold">{line.product.name}</h3>
                          <p className="mt-1 text-[11px] text-black/55">{variantLabel}</p>
                          <p className="mt-1 text-sm font-semibold">{formatMoney(unitPrice, currency)}</p>
                          <p className="mt-1 text-[10px] text-black/45">Disponibles: {line.variant.available_stock}</p>
                          <div className="mt-3 flex items-center gap-3">
                            <button type="button" onClick={() => changeQuantity(line.variant.id, -1)} className="h-8 w-8 border border-black/20" aria-label={`Reducir cantidad de ${line.product.name}`}>−</button>
                            <span className="min-w-4 text-center text-sm">{line.quantity}</span>
                            <button type="button" onClick={() => changeQuantity(line.variant.id, 1)} disabled={line.quantity >= line.variant.available_stock} className="h-8 w-8 border border-black/20 disabled:opacity-30" aria-label={`Aumentar cantidad de ${line.product.name}`}>+</button>
                            <button type="button" onClick={() => removeFromCart(line.variant.id)} className="ml-auto text-[10px] underline underline-offset-4">ELIMINAR</button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <div className="border-t border-black/10 px-5 py-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">Subtotal</span>
                    <span className="text-lg font-black">{formatMoney(cartTotalUSD, currency)}</span>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-black/50">El envío y los impuestos se calcularán al configurar el checkout internacional.</p>
                  {!checkoutOpen ? (
                    <div className="mt-5 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setCartOpen(false)}
                        className="border border-black/20 px-4 py-3 text-[10px] font-bold tracking-wider transition hover:bg-black/5"
                      >
                        SEGUIR COMPRANDO
                      </button>
                      <button
                        type="button"
                        onClick={() => setCheckoutOpen(true)}
                        className="bg-[#171717] px-4 py-3 text-[10px] font-bold tracking-wider text-white transition hover:bg-[#7555b5]"
                      >
                        PROCEDER AL PAGO →
                      </button>
                    </div>
                  ) : (
                    <div className="mt-5">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-sm font-black">DATOS DE ENTREGA</h3>
                        <button type="button" onClick={() => setCheckoutOpen(false)} className="text-[10px] font-bold underline underline-offset-4">VOLVER AL CARRITO</button>
                      </div>
                      <p className="mb-3 text-xs leading-5 text-black/60">Completa tus datos para continuar con el pago seguro mediante PayPal Sandbox.</p>
                      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {([['firstName','Nombre'],['lastName','Apellidos'],['email','Correo electrónico'],['phone','Teléfono'],['countryName','País'],['countryCode','Código país (2 letras)'],['addressLine1','Dirección'],['addressLine2','Apto / complemento (opcional)'],['city','Ciudad'],['stateRegion','Departamento / estado'],['postalCode','Código postal']] as const).map(([key,label]) => (
                          <label key={key} className="block text-[10px] font-semibold tracking-wide text-black/70">
                            {label}
                            <input required={!['addressLine2','stateRegion'].includes(key)} type={key==='email'?'email':'text'} value={customer[key]} onChange={(e)=>setCustomer(current=>({...current,[key]:key==='countryCode'?e.target.value.toUpperCase():e.target.value,...(key==='countryName'&&e.target.value==='Colombia'?{countryCode:'CO'}:key==='countryName'&&e.target.value==='Mexico'?{countryCode:'MX'}:key==='countryName'&&e.target.value==='United States'?{countryCode:'US'}:{})}))} maxLength={key==='countryCode'?2:180} className="mt-1 w-full border border-black/15 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#7555b5]" />
                          </label>
                        ))}
                      </div>
                      <PayPalButtons items={cartItems.map((line) => ({ variantId: line.variant.id, quantity: line.quantity }))} customer={customer} onSuccess={(result) => { setCompletedOrder({orderNumber:result.orderNumber,orderID:result.orderID}); setCart({}); setCartOpen(false); setCheckoutOpen(false); }} />
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
