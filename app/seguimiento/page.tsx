"use client";

import { useState, type FormEvent } from "react";

type TrackingResult = {
  order: {
    orderNumber: string;
    paymentStatus: string | null;
    fulfillmentStatus: string | null;
    createdAt: string;
    paidAt: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    shippingCarrier: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
  };
  items: { productName: string; quantity: number }[];
};

const steps = [
  { key: "pending", label: "Por preparar", description: "Tu compra está confirmada y espera preparación." },
  { key: "preparing", label: "Preparando", description: "Estamos preparando tu pedido." },
  { key: "shipped", label: "Enviado", description: "Tu pedido está en camino." },
  { key: "delivered", label: "Entregado", description: "El pedido figura como entregado." },
];
function date(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeStyle: "short" }).format(parsed);
}

export default function SeguimientoPage() {
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function searchOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/track", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No fue posible consultar el pedido.");
      setResult(data as TrackingResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible consultar el pedido.");
    } finally { setBusy(false); }
  }

  const currentIndex = result?.order.fulfillmentStatus === "awaiting_payment" ? -1 : steps.findIndex(step => step.key === result?.order.fulfillmentStatus);

  return (
    <main className="min-h-screen bg-[#faf9f6] px-4 py-10 text-[#171717] md:px-8 md:py-16">
      <div className="mx-auto max-w-2xl">
        <a href="/" className="text-sm font-black tracking-tight">SHIFU<span className="font-light"> CLUB ✳</span></a>
        <section className="mt-10 border border-black/10 bg-white p-6 shadow-sm md:p-9">
          <p className="text-[10px] font-bold tracking-[0.3em] text-[#7555b5]">SHIFU STORE · PEDIDOS</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Sigue tu pedido</h1>
          <p className="mt-3 text-sm leading-6 text-black/55">Ingresa el número de pedido y el correo utilizado al comprar para consultar el estado de tu envío.</p>
          <form onSubmit={searchOrder} className="mt-7 grid gap-4">
            <label className="text-xs font-bold">Número de pedido
              <input required autoComplete="off" value={orderNumber} onChange={event => setOrderNumber(event.target.value.toUpperCase())} placeholder="SHF-001001" maxLength={32} className="mt-2 w-full border border-black/15 bg-[#faf9f6] px-4 py-3 text-sm font-normal outline-none focus:border-[#7555b5]" />
            </label>
            <label className="text-xs font-bold">Correo electrónico de la compra
              <input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="tu@correo.com" maxLength={254} className="mt-2 w-full border border-black/15 bg-[#faf9f6] px-4 py-3 text-sm font-normal outline-none focus:border-[#7555b5]" />
            </label>
            {error && <p role="alert" className="border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">{error}</p>}
            <button disabled={busy} className="mt-1 w-full bg-[#171717] px-5 py-4 text-[10px] font-bold tracking-[0.18em] text-white transition hover:bg-[#7555b5] disabled:opacity-50">{busy ? "CONSULTANDO…" : "CONSULTAR PEDIDO"}</button>
          </form>
        </section>

        {result && (
          <section className="mt-5 border border-black/10 bg-white p-6 md:p-9">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/10 pb-5">
              <div><p className="text-[9px] font-bold tracking-[0.22em] text-black/45">NÚMERO DE PEDIDO</p><h2 className="mt-1 text-2xl font-black">{result.order.orderNumber}</h2></div>
              <span className="bg-[#d8c4ff] px-3 py-2 text-[10px] font-bold">{result.order.paymentStatus === "completed" ? "PAGO CONFIRMADO" : "PAGO PENDIENTE"}</span>
            </div>
            {result.order.paymentStatus !== "completed" ? (
              <p className="mt-5 text-sm leading-6 text-black/60">Todavía no vemos la confirmación del pago. El seguimiento logístico estará disponible cuando se confirme.</p>
            ) : (
              <div className="mt-7">
                <h3 className="text-xs font-black tracking-widest">ESTADO DE TU PEDIDO</h3>
                <ol className="mt-5 space-y-0">
                  {steps.map((step, index) => {
                    const done = currentIndex >= index;
                    const active = currentIndex === index;
                    const timestamp = step.key === "pending" ? result.order.paidAt : step.key === "shipped" ? result.order.shippedAt : step.key === "delivered" ? result.order.deliveredAt : null;
                    return <li key={step.key} className="relative flex gap-4 pb-7 last:pb-0">
                      <div className="relative flex w-6 shrink-0 justify-center"><span className={`relative z-10 mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-black ${done ? "border-[#7555b5] bg-[#d8c4ff] text-[#171717]" : "border-black/15 bg-white text-black/30"}`}>{done ? "✓" : index + 1}</span>{index < steps.length - 1 && <span className={`absolute top-6 h-full w-px ${currentIndex > index ? "bg-[#7555b5]" : "bg-black/10"}`} />}</div>
                      <div><p className={`text-sm font-bold ${active ? "text-[#7555b5]" : done ? "text-black" : "text-black/35"}`}>{step.label}</p><p className={`mt-1 text-xs leading-5 ${done ? "text-black/60" : "text-black/35"}`}>{step.description}</p>{timestamp && done ? <p className="mt-1 text-[10px] text-black/40">{date(timestamp)}</p> : null}</div>
                    </li>;
                  })}
                </ol>
              </div>
            )}
            {result.order.fulfillmentStatus === "shipped" || result.order.fulfillmentStatus === "delivered" ? (
              <div className="mt-7 border border-[#d8c4ff] bg-[#f8f4ff] p-4">
                <h3 className="text-xs font-black tracking-widest">DATOS DE ENVÍO</h3>
                <p className="mt-3 text-xs"><span className="text-black/50">Transportadora:</span> <strong>{result.order.shippingCarrier || "No especificada"}</strong></p>
                <p className="mt-2 text-xs"><span className="text-black/50">Número de guía:</span> <strong>{result.order.trackingNumber || "No registrado"}</strong></p>
                {result.order.trackingUrl ? <a href={result.order.trackingUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex bg-black px-4 py-3 text-[10px] font-bold tracking-wider text-white hover:bg-[#7555b5]">RASTREAR EN TRANSPORTADORA ↗</a> : <p className="mt-3 text-[10px] text-black/45">El enlace de rastreo todavía no está disponible.</p>}
              </div>
            ) : null}
            <div className="mt-7 border-t border-black/10 pt-5"><h3 className="text-xs font-black tracking-widest">PRODUCTOS</h3><div className="mt-3 space-y-2">{result.items.map((item,index) => <div key={`${item.productName}-${index}`} className="flex justify-between gap-4 text-xs"><span>{item.productName}</span><span className="font-bold">× {item.quantity}</span></div>)}</div></div>
          </section>
        )}
        <p className="mt-6 text-center text-[10px] text-black/40">¿Necesitas ayuda? Contacta al equipo de Shifu Club.</p>
      </div>
    </main>
  );
}
