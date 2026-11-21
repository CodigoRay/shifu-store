"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type Product = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  price_usd: number | string;
  active: boolean;
};

type Variant = {
  id: string;
  product_id: string;
  sku: string;
  size: string | null;
  color: string | null;
  color_hex: string | null;
  price_adjustment: number | string;
  stock_on_hand: number;
  reserved_quantity: number;
  available_stock: number;
  active: boolean;
};

type Movement = {
  id: string;
  variant_id: string;
  order_id: string | null;
  movement_type: string;
  quantity_delta: number;
  reserved_delta: number;
  stock_after: number;
  reserved_after: number;
  reason: string | null;
  created_at: string;
  sku: string;
  variant_label: string;
  product_name: string;
};

type Reservation = {
  id: string;
  order_id: string;
  variant_id: string;
  quantity: number;
  status: string;
  expires_at: string;
  created_at: string;
  order_number: string | null;
  payment_status: string | null;
  sku: string;
  variant_label: string;
  product_name: string;
};

type InventoryData = {
  products: Product[];
  variants: Variant[];
  movements: Movement[];
  reservations: Reservation[];
  releasedExpiredCount?: number;
};

const EMPTY_DATA: InventoryData = { products: [], variants: [], movements: [], reservations: [] };
const MOVEMENT_TYPES = ["all", "opening", "incoming", "restock", "adjustment", "reservation", "release", "reservation_release", "sale", "return"] as const;

function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function movementLabel(value: string) {
  const labels: Record<string, string> = {
    opening: "Inventario inicial",
    restock: "Reposición",
    adjustment: "Ajuste manual",
    reservation: "Reserva de checkout",
    release: "Liberación de reserva",
    reservation_release: "Liberación de reserva",
    sale: "Venta confirmada",
    return: "Devolución",
    incoming: "Entrada de inventario",
  };
  return labels[value] || value;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function remainingTime(value: string) {
  const milliseconds = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "Vencida; se liberará al actualizar";
  const minutes = Math.ceil(milliseconds / 60000);
  return minutes < 60 ? `Vence en ${minutes} min` : `Vence en ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export default function AdminInventoryPage() {
  const [data, setData] = useState<InventoryData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [selectedProductId, setSelectedProductId] = useState("");
  const [variantProductFilter, setVariantProductFilter] = useState("all");
  const [variantSearch, setVariantSearch] = useState("");
  const [variantStatusFilter, setVariantStatusFilter] = useState("all");
  const [lowStockThreshold, setLowStockThreshold] = useState("3");

  const [sku, setSku] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [colorHex, setColorHex] = useState("");
  const [priceAdjustment, setPriceAdjustment] = useState("0");
  const [initialStock, setInitialStock] = useState("0");
  const [adjustments, setAdjustments] = useState<Record<string, { delta: string; reason: string }>>({});

  const [movementSearch, setMovementSearch] = useState("");
  const [movementFilter, setMovementFilter] = useState<(typeof MOVEMENT_TYPES)[number]>("all");

  const loadInventory = useCallback(async () => {
    setError("");
    const response = await fetch("/api/admin/inventory", { cache: "no-store" });
    if (response.status === 401) {
      setLoggedIn(false);
      return;
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "No se pudo cargar el inventario.");
    setLoggedIn(true);
    setData({ ...EMPTY_DATA, ...result });
    setSelectedProductId((current) => current || result.products?.[0]?.id || "");
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/inventory", { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          setLoggedIn(false);
          return;
        }
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "No se pudo cargar el inventario.");
        setLoggedIn(true);
        setData({ ...EMPTY_DATA, ...result });
        setSelectedProductId(result.products?.[0]?.id || "");
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Error de conexión.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const threshold = Math.max(0, Math.min(100, Number.parseInt(lowStockThreshold, 10) || 0));
  const activeVariants = useMemo(() => data.variants.filter((variant) => variant.active), [data.variants]);

  const summary = useMemo(() => ({
    skus: activeVariants.length,
    physical: activeVariants.reduce((sum, variant) => sum + Number(variant.stock_on_hand), 0),
    reserved: activeVariants.reduce((sum, variant) => sum + Number(variant.reserved_quantity), 0),
    available: activeVariants.reduce((sum, variant) => sum + Number(variant.available_stock), 0),
    low: activeVariants.filter((variant) => variant.available_stock > 0 && variant.available_stock <= threshold).length,
    out: activeVariants.filter((variant) => variant.available_stock <= 0).length,
  }), [activeVariants, threshold]);

  const lowStockVariants = useMemo(
    () => activeVariants
      .filter((variant) => variant.available_stock <= threshold)
      .sort((a, b) => a.available_stock - b.available_stock || a.sku.localeCompare(b.sku)),
    [activeVariants, threshold],
  );

  const filteredVariants = useMemo(() => {
    const query = variantSearch.trim().toLowerCase();
    return data.variants.filter((variant) => {
      const product = data.products.find((item) => item.id === variant.product_id);
      const matchesProduct = variantProductFilter === "all" || variant.product_id === variantProductFilter;
      const haystack = [product?.name, variant.sku, variant.size, variant.color].filter(Boolean).join(" ").toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      const matchesStatus = variantStatusFilter === "all"
        || (variantStatusFilter === "active" && variant.active)
        || (variantStatusFilter === "inactive" && !variant.active)
        || (variantStatusFilter === "out" && variant.active && variant.available_stock <= 0)
        || (variantStatusFilter === "low" && variant.active && variant.available_stock > 0 && variant.available_stock <= threshold);
      return matchesProduct && matchesSearch && matchesStatus;
    });
  }, [data.products, data.variants, variantProductFilter, variantSearch, variantStatusFilter, threshold]);

  const filteredMovements = useMemo(() => {
    const query = movementSearch.trim().toLowerCase();
    return data.movements.filter((movement) => {
      const matchesType = movementFilter === "all" || movement.movement_type === movementFilter;
      const haystack = [movement.product_name, movement.sku, movement.variant_label, movement.reason, movement.order_id]
        .filter(Boolean).join(" ").toLowerCase();
      return matchesType && (!query || haystack.includes(query));
    });
  }, [data.movements, movementFilter, movementSearch]);

  async function createVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/inventory/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: selectedProductId, sku, size, color, colorHex, priceAdjustment, initialStock }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setLoggedIn(false);
        throw new Error("Tu sesión administrativa venció.");
      }
      if (!response.ok) throw new Error(result.error || "No se pudo crear la variante.");
      setSku(""); setSize(""); setColor(""); setColorHex(""); setPriceAdjustment("0"); setInitialStock("0");
      await loadInventory();
      setNotice("Variante creada y stock inicial registrado.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Error al crear la variante.");
    } finally {
      setBusy(false);
    }
  }

  async function adjustStock(variantId: string, forcedDelta?: number, forcedReason?: string) {
    const adjustment = adjustments[variantId] || { delta: "1", reason: "Reposición de inventario" };
    const delta = forcedDelta ?? Number(adjustment.delta);
    const reason = forcedReason ?? adjustment.reason;
    if (!Number.isInteger(delta) || delta === 0) {
      setError("El ajuste debe ser un número entero distinto de cero.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/inventory/variants/${variantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adjust_stock", delta, reason }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setLoggedIn(false);
        throw new Error("Tu sesión administrativa venció.");
      }
      if (!response.ok) throw new Error(result.error || "No se pudo ajustar el stock.");
      await loadInventory();
      setNotice(`${delta > 0 ? "Reposición registrada" : "Ajuste registrado"}: ${delta > 0 ? "+" : ""}${delta} unidades.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Error al ajustar el stock.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleVariant(variant: Variant) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/inventory/variants/${variant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_active", active: !variant.active }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "No se pudo cambiar el estado de la variante.");
      await loadInventory();
      setNotice(variant.active ? "Variante desactivada en la tienda." : "Variante activada en la tienda.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Error al cambiar el estado.");
    } finally {
      setBusy(false);
    }
  }

  async function releaseExpiredReservations() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/inventory/release-expired", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setLoggedIn(false);
        throw new Error("Tu sesión administrativa venció.");
      }
      if (!response.ok) throw new Error(result.error || "No se pudieron liberar las reservas vencidas.");
      await loadInventory();
      const count = Number(result.releasedCount || 0);
      setNotice(count > 0 ? `Se liberaron ${count} reserva(s) vencida(s).` : "No había reservas vencidas. Las reservas activas se conservaron.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Error al liberar reservas vencidas.");
    } finally {
      setBusy(false);
    }
  }

  function exportMovements() {
    const header = ["Fecha", "Producto", "SKU", "Variante", "Movimiento", "Cambio stock", "Cambio reservado", "Stock físico resultante", "Reservado resultante", "Motivo", "Order ID"];
    const rows = filteredMovements.map((movement) => [
      movement.created_at,
      movement.product_name,
      movement.sku,
      movement.variant_label,
      movementLabel(movement.movement_type),
      movement.quantity_delta,
      movement.reserved_delta,
      movement.stock_after,
      movement.reserved_after,
      movement.reason,
      movement.order_id,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `shifu-inventory-movements-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-[#f5f3ef] text-sm text-black/60">Cargando inventario…</main>;

  if (!loggedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f3ef] p-5 text-[#171717]">
        <section className="w-full max-w-md border border-black/10 bg-[#fffefa] p-8">
          <p className="text-[10px] font-bold tracking-[0.3em] text-[#7555b5]">SHIFU CLUB · ADMIN</p>
          <h1 className="mt-3 text-2xl font-black">Sesión requerida</h1>
          <p className="mt-2 text-sm text-black/60">Inicia sesión en el panel administrativo para gestionar las existencias.</p>
          <a href="/admin" className="mt-6 inline-flex bg-black px-5 py-3 text-[10px] font-bold tracking-widest text-white">IR AL ADMINISTRADOR</a>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f3ef] text-[#171717]">
      <header className="border-b border-black/10 bg-[#fffefa] px-4 py-5 md:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[9px] font-bold tracking-[0.3em] text-[#7555b5]">SHIFU CLUB ✳</p>
            <h1 className="mt-1 text-2xl font-black md:text-3xl">Control de inventario</h1>
            <p className="mt-1 text-xs text-black/50">Existencias, alertas, reposiciones y trazabilidad por SKU</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href="/admin" className="border border-black/15 px-3 py-2 text-[10px] font-bold tracking-wider hover:bg-black/5">PEDIDOS</a>
            <button type="button" onClick={() => void loadInventory().catch((reason) => setError(reason instanceof Error ? reason.message : "No se pudo actualizar el inventario."))} disabled={busy} className="bg-black px-3 py-2 text-[10px] font-bold tracking-wider text-white hover:bg-[#7555b5] disabled:opacity-50">ACTUALIZAR</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-7 px-4 py-7 md:px-10 md:py-10">
        {error && <div role="alert" className="border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        {notice && <div role="status" className="border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["SKU ACTIVOS", summary.skus],
            ["STOCK FÍSICO", summary.physical],
            ["RESERVADOS", summary.reserved],
            ["DISPONIBLES", summary.available],
            ["BAJO / AGOTADO", `${summary.low} / ${summary.out}`],
          ].map(([label, value]) => (
            <article key={String(label)} className="border border-black/10 bg-[#fffefa] p-5">
              <p className="text-[9px] font-bold tracking-widest text-black/45">{label}</p>
              <p className="mt-3 text-3xl font-black tabular-nums">{value}</p>
            </article>
          ))}
        </section>

        <section className="border border-black/10 bg-[#fffefa]">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-black/10 p-5">
            <div>
              <p className="text-[9px] font-bold tracking-[0.24em] text-[#7555b5]">ATENCIÓN DE STOCK</p>
              <h2 className="mt-1 text-lg font-black">Alertas de existencias bajas</h2>
              <p className="mt-1 text-xs text-black/50">Variantes activas con disponibilidad igual o inferior al umbral.</p>
            </div>
            <label className="text-[10px] font-bold text-black/60">ALERTAR CON
              <span className="ml-2 inline-flex items-center gap-2">
                <input type="number" min="0" max="100" value={lowStockThreshold} onChange={(event) => setLowStockThreshold(event.target.value)} className="w-20 border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-black" />
                <span>unidades o menos</span>
              </span>
            </label>
          </div>
          {lowStockVariants.length === 0 ? (
            <div className="p-7 text-sm text-black/55">No hay variantes por debajo del umbral de {threshold} unidades.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left">
                <thead className="bg-[#f8f6f2] text-[9px] font-bold tracking-widest text-black/45">
                  <tr><th className="px-5 py-3">PRODUCTO / VARIANTE</th><th className="px-5 py-3">SKU</th><th className="px-5 py-3">DISPONIBLE</th><th className="px-5 py-3">ACCIÓN RÁPIDA</th></tr>
                </thead>
                <tbody>
                  {lowStockVariants.map((variant) => {
                    const product = data.products.find((item) => item.id === variant.product_id);
                    return (
                      <tr key={variant.id} className="border-t border-black/5">
                        <td className="px-5 py-3"><p className="text-xs font-semibold">{product?.name || "Producto"}</p><p className="text-[10px] text-black/45">{[variant.size, variant.color].filter(Boolean).join(" · ")}</p></td>
                        <td className="px-5 py-3 text-xs">{variant.sku}</td>
                        <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${variant.available_stock <= 0 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{variant.available_stock <= 0 ? "AGOTADO" : `${variant.available_stock} unidades`}</span></td>
                        <td className="px-5 py-3"><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void adjustStock(variant.id, 5, "Reposición rápida desde alerta de stock bajo")} className="border border-black/15 px-3 py-2 text-[9px] font-bold hover:bg-black hover:text-white disabled:opacity-40">+5</button><button type="button" disabled={busy} onClick={() => void adjustStock(variant.id, 10, "Reposición rápida desde alerta de stock bajo")} className="border border-black/15 px-3 py-2 text-[9px] font-bold hover:bg-black hover:text-white disabled:opacity-40">+10</button><button type="button" onClick={() => { setVariantProductFilter(variant.product_id); setVariantSearch(variant.sku); }} className="px-2 py-2 text-[9px] font-bold text-[#7555b5] underline underline-offset-4">Ver variante</button></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="border border-black/10 bg-[#fffefa]">
          <div className="border-b border-black/10 p-5">
            <h2 className="text-lg font-black">Crear variante</h2>
            <p className="mt-1 text-xs text-black/50">Cada combinación de talla, color o diseño tiene su propio SKU y stock.</p>
          </div>
          <form onSubmit={createVariant} className="grid gap-3 p-5 md:grid-cols-4">
            <label className="text-[10px] font-bold text-black/65 md:col-span-2">Producto
              <select required value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)} className="mt-1 w-full border border-black/15 bg-white px-3 py-3 text-xs font-normal">
                {data.products.filter((product) => product.active).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-bold text-black/65">SKU único<input required minLength={2} maxLength={80} value={sku} onChange={(event) => setSku(event.target.value.toUpperCase())} placeholder="CAM-DOJO-M-NEG" className="mt-1 w-full border border-black/15 bg-white px-3 py-3 text-xs font-normal" /></label>
            <label className="text-[10px] font-bold text-black/65">Talla<input value={size} onChange={(event) => setSize(event.target.value)} placeholder="S, M, L, XL o Única" maxLength={40} className="mt-1 w-full border border-black/15 bg-white px-3 py-3 text-xs font-normal" /></label>
            <label className="text-[10px] font-bold text-black/65">Color o diseño<input value={color} onChange={(event) => setColor(event.target.value)} placeholder="Negro, crema, Diseño 1…" maxLength={60} className="mt-1 w-full border border-black/15 bg-white px-3 py-3 text-xs font-normal" /></label>
            <label className="text-[10px] font-bold text-black/65">Código de color<input value={colorHex} onChange={(event) => setColorHex(event.target.value)} placeholder="#171717 (opcional)" maxLength={7} className="mt-1 w-full border border-black/15 bg-white px-3 py-3 text-xs font-normal" /></label>
            <label className="text-[10px] font-bold text-black/65">Ajuste de precio USD<input type="number" min="0" step="0.01" value={priceAdjustment} onChange={(event) => setPriceAdjustment(event.target.value)} className="mt-1 w-full border border-black/15 bg-white px-3 py-3 text-xs font-normal" /></label>
            <label className="text-[10px] font-bold text-black/65">Stock inicial<input type="number" min="0" max="10000" step="1" value={initialStock} onChange={(event) => setInitialStock(event.target.value)} className="mt-1 w-full border border-black/15 bg-white px-3 py-3 text-xs font-normal" /></label>
            <div className="flex items-end md:col-span-4"><button type="submit" disabled={busy || !selectedProductId} className="bg-black px-6 py-3 text-[10px] font-bold tracking-widest text-white hover:bg-[#7555b5] disabled:opacity-40">{busy ? "GUARDANDO…" : "CREAR VARIANTE"}</button></div>
          </form>
        </section>

        <section className="border border-black/10 bg-[#fffefa]">
          <div className="flex flex-col gap-3 border-b border-black/10 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-lg font-black">Existencias por variante</h2><p className="mt-1 text-xs text-black/50">Las unidades disponibles descuentan las reservas temporales activas.</p></div>
              <span className="text-[10px] text-black/45">{filteredVariants.length} de {data.variants.length} variantes</span>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_220px_180px]">
              <input value={variantSearch} onChange={(event) => setVariantSearch(event.target.value)} placeholder="Buscar producto, SKU, talla o color…" className="border border-black/15 bg-white px-3 py-3 text-xs outline-none focus:border-[#7555b5]" />
              <select value={variantProductFilter} onChange={(event) => setVariantProductFilter(event.target.value)} className="border border-black/15 bg-white px-3 py-3 text-xs"><option value="all">Todos los productos</option>{data.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
              <select value={variantStatusFilter} onChange={(event) => setVariantStatusFilter(event.target.value)} className="border border-black/15 bg-white px-3 py-3 text-xs"><option value="all">Todos los estados</option><option value="active">Activas</option><option value="inactive">Inactivas</option><option value="low">Stock bajo</option><option value="out">Agotadas</option></select>
            </div>
          </div>
          {filteredVariants.length === 0 ? <div className="p-10 text-center text-sm text-black/50">No hay variantes que coincidan con estos filtros.</div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left">
                <thead className="bg-[#f8f6f2] text-[9px] font-bold tracking-widest text-black/45"><tr><th className="px-5 py-3">PRODUCTO / SKU</th><th className="px-5 py-3">PRECIO</th><th className="px-5 py-3">FÍSICO</th><th className="px-5 py-3">RESERVADO</th><th className="px-5 py-3">DISPONIBLE</th><th className="px-5 py-3">REPOSICIÓN / AJUSTE</th><th className="px-5 py-3">ESTADO</th></tr></thead>
                <tbody>
                  {filteredVariants.map((variant) => {
                    const product = data.products.find((item) => item.id === variant.product_id);
                    const adjustment = adjustments[variant.id] || { delta: "1", reason: "Reposición de inventario" };
                    return (
                      <tr key={variant.id} className="border-t border-black/5 align-top">
                        <td className="px-5 py-4"><p className="text-xs font-bold">{product?.name || "Producto"}</p><p className="mt-1 text-[10px] text-black/55">{[variant.size, variant.color].filter(Boolean).join(" · ") || "Variante"}</p><p className="mt-1 text-[10px] text-black/40">{variant.sku}</p></td>
                        <td className="px-5 py-4 text-xs">${(Number(product?.price_usd || 0) + Number(variant.price_adjustment || 0)).toFixed(2)}</td>
                        <td className="px-5 py-4 text-xs font-semibold">{variant.stock_on_hand}</td>
                        <td className="px-5 py-4 text-xs">{variant.reserved_quantity}</td>
                        <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${variant.available_stock <= 0 ? "bg-red-50 text-red-700" : variant.available_stock <= threshold ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{variant.available_stock}</span></td>
                        <td className="px-5 py-4"><div className="flex min-w-[275px] gap-2"><input aria-label="Unidades para reponer o ajustar" type="number" step="1" value={adjustment.delta} onChange={(event) => setAdjustments((current) => ({ ...current, [variant.id]: { delta: event.target.value, reason: current[variant.id]?.reason ?? "Reposición de inventario" } }))} className="w-20 border border-black/15 bg-white px-2 py-2 text-xs" /><input aria-label="Motivo de la reposición o ajuste" value={adjustment.reason} onChange={(event) => setAdjustments((current) => ({ ...current, [variant.id]: { delta: current[variant.id]?.delta ?? "1", reason: event.target.value } }))} className="w-40 border border-black/15 bg-white px-2 py-2 text-[10px]" /><button type="button" disabled={busy} onClick={() => void adjustStock(variant.id)} className="bg-black px-3 py-2 text-[9px] font-bold text-white disabled:opacity-40">APLICAR</button></div><p className="mt-1 text-[9px] text-black/40">Positivo = reponer · negativo = ajuste. No puede quedar por debajo de lo reservado.</p></td>
                        <td className="px-5 py-4"><button type="button" disabled={busy} onClick={() => void toggleVariant(variant)} className={`text-[9px] font-bold underline underline-offset-4 disabled:opacity-40 ${variant.active ? "text-emerald-700" : "text-red-700"}`}>{variant.active ? "ACTIVA" : "INACTIVA"}</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="border border-black/10 bg-[#fffefa]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 p-5">
            <div><h2 className="text-lg font-black">Reservas temporales de checkout</h2><p className="mt-1 text-xs text-black/50">Las reservas vencidas se liberan automáticamente; las activas se conservan para no interrumpir un pago en curso.</p></div>
            <button type="button" disabled={busy} onClick={() => void releaseExpiredReservations()} className="border border-black/15 px-4 py-2 text-[9px] font-bold tracking-wider hover:bg-black hover:text-white disabled:opacity-40">LIBERAR VENCIDAS</button>
          </div>
          {data.reservations.length === 0 ? (
            <p className="p-7 text-sm text-black/50">No hay reservas activas ahora.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left">
                <thead className="bg-[#f8f6f2] text-[9px] font-bold tracking-widest text-black/45"><tr><th className="px-5 py-3">PEDIDO</th><th className="px-5 py-3">PRODUCTO / SKU</th><th className="px-5 py-3">UNIDADES</th><th className="px-5 py-3">ESTADO DE PAGO</th><th className="px-5 py-3">VENCIMIENTO</th></tr></thead>
                <tbody>{data.reservations.map((reservation) => <tr key={reservation.id} className="border-t border-black/5"><td className="px-5 py-3 text-xs font-semibold">{reservation.order_number || reservation.order_id.slice(0, 8)}</td><td className="px-5 py-3"><p className="text-xs font-semibold">{reservation.product_name}</p><p className="text-[10px] text-black/45">{reservation.variant_label} · {reservation.sku}</p></td><td className="px-5 py-3 text-xs">{reservation.quantity}</td><td className="px-5 py-3 text-xs">{reservation.payment_status || "Pendiente"}</td><td className="px-5 py-3 text-xs"><span className="font-semibold">{remainingTime(reservation.expires_at)}</span><p className="mt-1 text-[10px] text-black/40">{date(reservation.expires_at)}</p></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>

        <section className="border border-black/10 bg-[#fffefa]">
          <div className="flex flex-col gap-3 border-b border-black/10 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-lg font-black">Historial de movimientos</h2><p className="mt-1 text-xs text-black/50">Ventas, reposiciones, ajustes, reservas y liberaciones recientes.</p></div>
              <button type="button" onClick={exportMovements} disabled={filteredMovements.length === 0} className="border border-black/15 px-4 py-2 text-[9px] font-bold tracking-wider hover:bg-black hover:text-white disabled:opacity-40">EXPORTAR CSV</button>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_230px]"><input value={movementSearch} onChange={(event) => setMovementSearch(event.target.value)} placeholder="Buscar producto, SKU, motivo u orden…" className="border border-black/15 bg-white px-3 py-3 text-xs outline-none focus:border-[#7555b5]" /><select value={movementFilter} onChange={(event) => setMovementFilter(event.target.value as (typeof MOVEMENT_TYPES)[number])} className="border border-black/15 bg-white px-3 py-3 text-xs">{MOVEMENT_TYPES.map((type) => <option key={type} value={type}>{type === "all" ? "Todos los movimientos" : movementLabel(type)}</option>)}</select></div>
            <p className="text-[10px] text-black/40">Mostrando {filteredMovements.length} de los últimos {data.movements.length} movimientos cargados.</p>
          </div>
          {filteredMovements.length === 0 ? <p className="p-8 text-center text-xs text-black/50">No hay movimientos que coincidan con el filtro.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left">
                <thead className="bg-[#f8f6f2] text-[9px] font-bold tracking-widest text-black/45"><tr><th className="px-5 py-3">FECHA</th><th className="px-5 py-3">PRODUCTO / SKU</th><th className="px-5 py-3">MOVIMIENTO</th><th className="px-5 py-3">CAMBIO</th><th className="px-5 py-3">STOCK RESULTANTE</th><th className="px-5 py-3">MOTIVO</th></tr></thead>
                <tbody>{filteredMovements.map((movement) => <tr key={movement.id} className="border-t border-black/5"><td className="px-5 py-3 text-[10px] text-black/55">{date(movement.created_at)}</td><td className="px-5 py-3"><p className="text-xs font-semibold">{movement.product_name}</p><p className="text-[10px] text-black/45">{movement.variant_label} · {movement.sku}</p></td><td className="px-5 py-3 text-xs">{movementLabel(movement.movement_type)}</td><td className="px-5 py-3 text-xs tabular-nums">{movement.quantity_delta > 0 ? "+" : ""}{movement.quantity_delta}{movement.reserved_delta ? ` · reserva ${movement.reserved_delta > 0 ? "+" : ""}${movement.reserved_delta}` : ""}</td><td className="px-5 py-3 text-xs">{movement.stock_after} físico · {movement.reserved_after} reservado</td><td className="px-5 py-3 text-[10px] text-black/55">{movement.reason || "—"}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
