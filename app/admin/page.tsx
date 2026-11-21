"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type Order = {
  id: string;
  order_number: string;
  guest_email: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  customer_phone: string | null;
  currency: string | null;
  subtotal: number | string | null;
  discount_amount: number | string | null;
  shipping_amount: number | string | null;
  tax_amount: number | string | null;
  total: number | string | null;
  status: string | null;
  payment_status: string | null;
  fulfillment_status: string | null;
  shipping_carrier?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  paid_at: string | null;
  created_at: string;
  [key: string]: unknown;
};

type OrderItem = { product_id: string | null; product_name: string; variant_label?: string | null; variant_sku?: string | null; quantity: number; unit_price: number | string; line_total: number | string };
type OrderDetail = { order: Order; items: OrderItem[] };
type Filter = "all" | "awaiting_payment" | "pending" | "preparing" | "shipped" | "delivered";

const fulfillmentLabels: Record<string, string> = {
  awaiting_payment: "Esperando pago",
  pending: "Por preparar",
  preparing: "Preparando",
  shipped: "Enviado",
  delivered: "Entregado",
};
const paymentLabels: Record<string, string> = { pending: "Pendiente", completed: "Pagado", failed: "Fallido", refunded: "Reembolsado" };

function money(value: number | string | null | undefined, currency = "USD") {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD", maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
}
function date(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}
function statusClass(value: string | null) {
  if (value === "delivered" || value === "completed") return "bg-emerald-50 text-emerald-700";
  if (value === "shipped" || value === "preparing" || value === "paid") return "bg-violet-100 text-violet-800";
  if (value === "failed" || value === "cancelled") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-800";
}

export default function AdminPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [trackingCarrier, setTrackingCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");

  const loadOrders = useCallback(async () => {
    setError("");
    const response = await fetch("/api/admin/orders", { cache: "no-store" });
    if (response.status === 401) {
      setLoggedIn(false);
      return false;
    }
    setLoggedIn(true);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || "No se pudieron cargar los pedidos.");
      return false;
    }
    setOrders(data.orders ?? []);
    return true;
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/orders", { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) { setLoggedIn(false); return; }
        setLoggedIn(true);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) setError(data.error || "No se pudieron cargar los pedidos.");
        else setOrders(data.orders ?? []);
      })
      .catch(() => { if (active) setError("No fue posible conectar con el servidor."); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo iniciar sesión.");
      setPassword("");
      setLoggedIn(true);
      await loadOrders();
    } catch (err) { setError(err instanceof Error ? err.message : "Error de acceso."); }
    finally { setBusy(false); }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setLoggedIn(false); setOrders([]); setSelected(null); setNotice("");
  }

  async function openOrder(id: string) {
    setDetailLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/orders/${id}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { setLoggedIn(false); return; }
      if (!response.ok) throw new Error(data.error || "No se pudo abrir el pedido.");
      setSelected(data);
      setTrackingCarrier(data.order.shipping_carrier ?? "");
      setTrackingNumber(data.order.tracking_number ?? "");
      setTrackingUrl(data.order.tracking_url ?? "");
    } catch (err) { setError(err instanceof Error ? err.message : "Error al abrir el pedido."); }
    finally { setDetailLoading(false); }
  }

  async function persistShipping(status?: string) {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const payload: Record<string, string> = {
        shippingCarrier: trackingCarrier,
        trackingNumber,
        trackingUrl,
      };
      if (status) payload.fulfillmentStatus = status;
      const response = await fetch(`/api/admin/orders/${selected.order.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo actualizar el pedido.");
      const updatedOrder = { ...selected.order, ...data };
      setSelected({ ...selected, order: updatedOrder });
      setOrders(current => current.map(order => order.id === selected.order.id ? { ...order, fulfillment_status: data.fulfillment_status ?? order.fulfillment_status } : order));
      setNotice(status === "shipped" ? "Pedido marcado como enviado y seguimiento guardado." : status === "delivered" ? "Pedido marcado como entregado." : "Datos de seguimiento guardados.");
    } catch (err) { setError(err instanceof Error ? err.message : "Error al actualizar."); }
    finally { setBusy(false); }
  }

  async function updateFulfillment(nextStatus: string) {
    await persistShipping(nextStatus);
  }


  const filteredOrders = useMemo(() => orders.filter(order => {
    const text = `${order.order_number} ${order.guest_email ?? ""} ${order.customer_first_name ?? ""} ${order.customer_last_name ?? ""}`.toLowerCase();
    const matchesSearch = text.includes(search.toLowerCase().trim());
    const matchesFilter = filter === "all" || (filter === "awaiting_payment" ? order.payment_status !== "completed" : order.fulfillment_status === filter);
    return matchesSearch && matchesFilter;
  }), [orders, search, filter]);

  const paidOrders = orders.filter(order => order.payment_status === "completed");
  const loadedSales = paidOrders.reduce((sum, order) => sum + Number(order.total ?? 0), 0);

  if (checking) return <main className="flex min-h-screen items-center justify-center bg-[#f5f3ef] text-sm text-black/60">Cargando acceso administrativo…</main>;

  if (!loggedIn) return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f3ef] px-4 py-12 text-[#171717]">
      <section className="w-full max-w-md border border-black/10 bg-[#fffefa] p-8 shadow-sm">
        <p className="text-[10px] font-bold tracking-[0.3em] text-[#7555b5]">SHIFU CLUB · ADMIN</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight">Panel de pedidos</h1>
        <p className="mt-2 text-sm leading-6 text-black/55">Acceso privado para gestionar las compras de Shifu Store.</p>
        <form onSubmit={login} className="mt-8 space-y-4">
          <label className="block text-xs font-bold">Contraseña administrativa
            <input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full border border-black/15 bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[#7555b5]" />
          </label>
          {error && <p role="alert" className="border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
          <button disabled={busy} className="w-full bg-[#171717] px-5 py-4 text-[10px] font-bold tracking-[0.18em] text-white transition hover:bg-[#7555b5] disabled:opacity-50">{busy ? "VALIDANDO…" : "ENTRAR AL PANEL"}</button>
        </form>
        <a href="/" className="mt-6 inline-block text-xs text-black/50 underline underline-offset-4">Volver a la tienda</a>
      </section>
    </main>
  );

  return (
    <main className="min-h-screen bg-[#f5f3ef] text-[#171717]">
      <header className="border-b border-black/10 bg-[#fffefa] px-4 py-5 md:px-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="text-[9px] font-bold tracking-[0.3em] text-[#7555b5]">SHIFU CLUB ✳</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight md:text-3xl">Panel administrativo</h1>
            <p className="mt-1 text-xs text-black/50">Gestión de pedidos y entregas</p>
          </div>
          <div className="flex items-center gap-2">
            <a href="/admin/inventario" className="border border-black/15 px-3 py-2 text-[10px] font-bold tracking-wider hover:bg-black/5">INVENTARIO</a><a href="/seguimiento" target="_blank" rel="noopener noreferrer" className="border border-black/15 px-3 py-2 text-[10px] font-bold tracking-wider hover:bg-black/5">VER SEGUIMIENTO</a><button onClick={() => void loadOrders()} className="border border-black/15 px-3 py-2 text-[10px] font-bold tracking-wider hover:bg-black/5">ACTUALIZAR</button>
            <button onClick={() => void logout()} className="bg-black px-3 py-2 text-[10px] font-bold tracking-wider text-white hover:bg-[#7555b5]">SALIR</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-7 md:px-10 md:py-10">
        {error && <div role="alert" className="mb-5 border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        {notice && <div role="status" className="mb-5 border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

        <div className="grid gap-3 sm:grid-cols-3">
          <article className="border border-black/10 bg-[#fffefa] p-5"><p className="text-[10px] font-bold tracking-widest text-black/45">PEDIDOS CARGADOS</p><p className="mt-3 text-3xl font-black tabular-nums">{orders.length}</p><p className="mt-1 text-[10px] text-black/45">Últimos 100 pedidos</p></article>
          <article className="border border-black/10 bg-[#fffefa] p-5"><p className="text-[10px] font-bold tracking-widest text-black/45">PAGOS CONFIRMADOS</p><p className="mt-3 text-3xl font-black tabular-nums">{paidOrders.length}</p><p className="mt-1 text-[10px] text-black/45">Dentro de los pedidos cargados</p></article>
          <article className="border border-black/10 bg-[#fffefa] p-5"><p className="text-[10px] font-bold tracking-widest text-black/45">VENTAS CONFIRMADAS</p><p className="mt-3 text-3xl font-black tabular-nums">{money(loadedSales, "USD")}</p><p className="mt-1 text-[10px] text-black/45">Suma de los pagos cargados</p></article>
        </div>

        <section className="mt-8 border border-black/10 bg-[#fffefa]">
          <div className="flex flex-col gap-3 border-b border-black/10 p-5 md:flex-row md:items-center md:justify-between">
            <div><h2 className="text-lg font-black">Pedidos recientes</h2><p className="mt-1 text-xs text-black/50">Selecciona un pedido para consultar sus datos y actualizar la entrega.</p></div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar pedido o cliente…" className="min-w-0 border border-black/15 bg-white px-3 py-2 text-xs outline-none focus:border-[#7555b5] sm:w-56" />
              <select value={filter} onChange={event => setFilter(event.target.value as Filter)} className="border border-black/15 bg-white px-3 py-2 text-xs outline-none focus:border-[#7555b5]">
                <option value="all">Todos los estados</option><option value="awaiting_payment">Esperando pago</option><option value="pending">Por preparar</option><option value="preparing">Preparando</option><option value="shipped">Enviados</option><option value="delivered">Entregados</option>
              </select>
            </div>
          </div>
          {orders.length === 0 ? <div className="p-12 text-center"><p className="text-sm font-bold">Todavía no hay pedidos.</p><p className="mt-2 text-xs text-black/50">Cuando se registren compras, aparecerán aquí.</p></div> : filteredOrders.length === 0 ? <p className="p-10 text-center text-sm text-black/50">No hay pedidos que coincidan con la búsqueda.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-[#f8f6f2] text-[9px] font-bold tracking-widest text-black/45"><tr><th className="px-5 py-3">PEDIDO</th><th className="px-5 py-3">CLIENTE</th><th className="px-5 py-3">FECHA</th><th className="px-5 py-3">PAGO</th><th className="px-5 py-3">ENTREGA</th><th className="px-5 py-3 text-right">TOTAL</th></tr></thead>
                <tbody>{filteredOrders.map(order => <tr key={order.id} onClick={() => void openOrder(order.id)} className="cursor-pointer border-t border-black/5 transition hover:bg-[#f8f6f2]"><td className="px-5 py-4"><span className="font-bold text-sm">{order.order_number}</span><span className="mt-1 block text-[10px] text-black/40">Ver detalle →</span></td><td className="px-5 py-4"><span className="block text-xs font-semibold">{[order.customer_first_name, order.customer_last_name].filter(Boolean).join(" ") || "Cliente"}</span><span className="mt-1 block text-[10px] text-black/45">{order.guest_email || "Sin correo"}</span></td><td className="px-5 py-4 text-xs text-black/60">{date(order.created_at)}</td><td className="px-5 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-bold ${statusClass(order.payment_status)}`}>{paymentLabels[order.payment_status || ""] || order.payment_status || "—"}</span></td><td className="px-5 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-bold ${statusClass(order.fulfillment_status)}`}>{fulfillmentLabels[order.fulfillment_status || ""] || order.fulfillment_status || "—"}</span></td><td className="px-5 py-4 text-right text-sm font-black">{money(order.total, order.currency || "USD")}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
        <p className="mt-4 text-[10px] leading-5 text-black/45">Por ahora se muestran hasta 100 pedidos recientes. Los importes del resumen corresponden únicamente a los pedidos cargados en esta vista.</p>
      </div>

      {detailLoading && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 text-sm text-white">Cargando pedido…</div>}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button aria-label="Cerrar detalle" onClick={() => setSelected(null)} className="absolute inset-0 bg-black/45" />
          <aside className="relative z-10 flex h-full w-full max-w-xl flex-col bg-[#fffefa] shadow-2xl">
            <div className="flex items-start justify-between border-b border-black/10 p-5"><div><p className="text-[9px] font-bold tracking-[0.25em] text-[#7555b5]">DETALLE DEL PEDIDO</p><h2 className="mt-1 text-2xl font-black">{selected.order.order_number}</h2><p className="mt-1 text-[10px] text-black/45">Creado: {date(selected.order.created_at)}</p></div><button onClick={() => setSelected(null)} aria-label="Cerrar" className="px-2 text-2xl">×</button></div>
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <section className="grid grid-cols-2 gap-3"><div className="border border-black/10 p-3"><p className="text-[9px] font-bold tracking-widest text-black/45">PAGO</p><span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass(selected.order.payment_status)}`}>{paymentLabels[selected.order.payment_status || ""] || selected.order.payment_status || "—"}</span></div><div className="border border-black/10 p-3"><p className="text-[9px] font-bold tracking-widest text-black/45">ENTREGA</p><span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass(selected.order.fulfillment_status)}`}>{fulfillmentLabels[selected.order.fulfillment_status || ""] || selected.order.fulfillment_status || "—"}</span></div></section>
              <section><h3 className="text-xs font-black tracking-wider">CLIENTE</h3><div className="mt-2 border border-black/10 p-4 text-xs leading-6"><p className="font-bold">{[selected.order.customer_first_name, selected.order.customer_last_name].filter(Boolean).join(" ") || "—"}</p><p>{String(selected.order.guest_email || "Sin correo")}</p><p>{String(selected.order.customer_phone || "Sin teléfono")}</p></div></section>
              <section><h3 className="text-xs font-black tracking-wider">DIRECCIÓN DE ENTREGA</h3><div className="mt-2 border border-black/10 p-4 text-xs leading-6"><p>{String(selected.order.shipping_recipient || "")}</p><p>{String(selected.order.shipping_address_line1 || "")}</p>{selected.order.shipping_address_line2 ? <p>{String(selected.order.shipping_address_line2)}</p> : null}<p>{[selected.order.shipping_city, selected.order.shipping_state_region, selected.order.shipping_postal_code].filter(Boolean).join(", ")}</p><p>{String(selected.order.shipping_country_name || "")}</p><p>Tel. {String(selected.order.shipping_phone || selected.order.customer_phone || "—")}</p></div></section>
              <section><h3 className="text-xs font-black tracking-wider">PRODUCTOS</h3><div className="mt-2 divide-y divide-black/10 border border-black/10">{selected.items.map((item,index) => <div key={`${item.product_id || item.product_name}-${index}`} className="flex items-center justify-between gap-4 p-3"><div><p className="text-xs font-bold">{item.product_name}</p><p className="mt-1 text-[10px] text-black/50">{item.variant_label ? `${item.variant_label} · ` : ""}Cantidad: {item.quantity} · {money(item.unit_price, selected.order.currency || "USD")} c/u</p></div><p className="text-xs font-black">{money(item.line_total, selected.order.currency || "USD")}</p></div>)}</div></section>
              <section className="space-y-2 border border-black/10 p-4 text-xs"><div className="flex justify-between"><span className="text-black/55">Subtotal</span><span>{money(selected.order.subtotal, selected.order.currency || "USD")}</span></div><div className="flex justify-between"><span className="text-black/55">Descuento</span><span>{money(selected.order.discount_amount, selected.order.currency || "USD")}</span></div><div className="flex justify-between"><span className="text-black/55">Envío</span><span>{money(selected.order.shipping_amount, selected.order.currency || "USD")}</span></div><div className="flex justify-between"><span className="text-black/55">Impuestos</span><span>{money(selected.order.tax_amount, selected.order.currency || "USD")}</span></div><div className="mt-2 flex justify-between border-t border-black/10 pt-3 text-sm font-black"><span>Total</span><span>{money(selected.order.total, selected.order.currency || "USD")}</span></div></section>
              {selected.order.paypal_order_id ? <section className="text-[10px] leading-5 text-black/45"><p>Referencia PayPal (orden): {String(selected.order.paypal_order_id)}</p>{selected.order.paypal_capture_id ? <p>Captura: {String(selected.order.paypal_capture_id)}</p> : null}<p>Pago confirmado: {date(selected.order.paid_at)}</p></section> : null}
              <section className="border border-[#d8c4ff] bg-[#f7f2ff] p-4"><h3 className="text-xs font-black">DATOS DE SEGUIMIENTO</h3>
                <div className="mt-3 grid gap-3">
                  <label className="block text-[10px] font-bold">Transportadora
                    <input value={trackingCarrier} onChange={event => setTrackingCarrier(event.target.value)} maxLength={100} placeholder="Ej. Servientrega, Coordinadora, DHL" className="mt-1 w-full border border-black/15 bg-white px-3 py-2 text-xs font-normal outline-none focus:border-[#7555b5]" />
                  </label>
                  <label className="block text-[10px] font-bold">Número de guía
                    <input value={trackingNumber} onChange={event => setTrackingNumber(event.target.value)} maxLength={120} placeholder="Código de rastreo" className="mt-1 w-full border border-black/15 bg-white px-3 py-2 text-xs font-normal outline-none focus:border-[#7555b5]" />
                  </label>
                  <label className="block text-[10px] font-bold">Enlace de rastreo (HTTPS)
                    <input value={trackingUrl} onChange={event => setTrackingUrl(event.target.value)} maxLength={500} placeholder="https://transportadora.com/rastreo/..." className="mt-1 w-full border border-black/15 bg-white px-3 py-2 text-xs font-normal outline-none focus:border-[#7555b5]" />
                  </label>
                </div>
                {selected.order.payment_status !== "completed" ? <p className="mt-3 text-xs leading-5 text-black/60">El pedido no se puede preparar hasta que el pago esté confirmado.</p> : selected.order.fulfillment_status === "pending" ? <button disabled={busy} onClick={() => void updateFulfillment("preparing")} className="mt-3 w-full bg-black px-4 py-3 text-[10px] font-bold tracking-widest text-white disabled:opacity-50">{busy ? "GUARDANDO…" : "MARCAR COMO PREPARANDO"}</button> : selected.order.fulfillment_status === "preparing" ? <button disabled={busy || !trackingCarrier.trim() || !trackingNumber.trim()} onClick={() => void updateFulfillment("shipped")} className="mt-3 w-full bg-black px-4 py-3 text-[10px] font-bold tracking-widest text-white disabled:opacity-50">{busy ? "GUARDANDO…" : "MARCAR COMO ENVIADO"}</button> : selected.order.fulfillment_status === "shipped" ? <><button disabled={busy} onClick={() => void persistShipping()} className="mt-3 w-full border border-black/20 bg-white px-4 py-3 text-[10px] font-bold tracking-widest disabled:opacity-50">{busy ? "GUARDANDO…" : "GUARDAR DATOS DE SEGUIMIENTO"}</button><button disabled={busy} onClick={() => void updateFulfillment("delivered")} className="mt-2 w-full bg-black px-4 py-3 text-[10px] font-bold tracking-widest text-white disabled:opacity-50">{busy ? "GUARDANDO…" : "MARCAR COMO ENTREGADO"}</button></> : <p className="mt-3 text-xs leading-5 text-black/60">{selected.order.fulfillment_status === "delivered" ? "Este pedido ya figura como entregado." : "El pedido está esperando confirmación de pago."}</p>}
                {selected.order.tracking_number ? <p className="mt-3 text-[10px] leading-5 text-black/60">Seguimiento guardado: {String(selected.order.shipping_carrier || "Transportadora")} · {String(selected.order.tracking_number)}{selected.order.tracking_url ? <> · <a className="underline" href={String(selected.order.tracking_url)} target="_blank" rel="noopener noreferrer">Abrir enlace</a></> : null}</p> : null}
                <p className="mt-3 text-[10px] leading-4 text-black/55">El cliente podrá consultar estos datos en /seguimiento con su número de pedido y correo de compra.</p>
              </section>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
