"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type CartItem = { variantId: string; quantity: number };
type CheckoutCustomer = {
  firstName: string; lastName: string; email: string; phone: string;
  countryCode: string; countryName: string; addressLine1: string;
  addressLine2: string; city: string; stateRegion: string; postalCode: string;
};

type PayPalButtonInstance = {
  render: (target: HTMLElement) => Promise<void>;
  close?: () => Promise<void> | void;
};

type PayPalNamespace = {
  Buttons: (options: {
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onCancel?: (data?: { orderID?: string }) => void;
    onError?: (error: unknown) => void;
  }) => PayPalButtonInstance;
};

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

export default function PayPalButtons({
  items,
  customer,
  onSuccess,
}: {
  items: CartItem[];
  customer: CheckoutCustomer;
  onSuccess: (result: { orderID: string; orderNumber: string }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<PayPalButtonInstance | null>(null);
  const customerRef = useRef(customer);
  customerRef.current = customer;
  const lastOrderIdRef = useRef<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
  const cartKey = items.map((item) => `${item.variantId}:${item.quantity}`).join("|");

  useEffect(() => {
    if (!sdkReady || !window.paypal || !containerRef.current || !clientId || items.length === 0) return;

    let cancelled = false;
    const container = containerRef.current;
    container.innerHTML = "";
    setMessage("");

    const buttons = window.paypal.Buttons({
      createOrder: async () => {
        setBusy(true);
        setMessage("");
        const response = await fetch("/api/paypal/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items, customer: customerRef.current }),
        });
        const data = await response.json();
        if (!response.ok || typeof data.id !== "string") {
          setBusy(false);
          const error = data.error || "No fue posible crear la orden.";
          setMessage(error);
          throw new Error(error);
        }
        lastOrderIdRef.current = data.id;
        return data.id;
      },
      onApprove: async (data) => {
        try {
          const response = await fetch("/api/paypal/capture-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderID: data.orderID }),
          });
          const result = await response.json();
          if (!response.ok || result.status !== "COMPLETED") {
            setMessage(result.error || "PayPal todavía no ha confirmado el pago.");
            return;
          }
          lastOrderIdRef.current = null;
          onSuccess({ orderID: data.orderID, orderNumber: result.orderNumber });
        } catch (error) {
          console.error("Error confirmando el pago de PayPal:", error);
          setMessage("No pudimos confirmar el pago. No vuelvas a pagar; conserva tu referencia de PayPal y contacta con soporte.");
        } finally {
          setBusy(false);
        }
      },
      onCancel: (data) => {
        const orderID = data?.orderID ?? lastOrderIdRef.current;
        if (orderID) {
          void fetch("/api/paypal/release-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderID }),
          }).catch((error) => console.warn("No se pudo liberar la reserva cancelada.", error));
        }
        lastOrderIdRef.current = null;
        setBusy(false);
        setMessage("El pago fue cancelado. Tu carrito sigue intacto.");
      },
      onError: (error) => {
        console.error("PayPal Checkout error", error);
        if (lastOrderIdRef.current) {
          void fetch("/api/paypal/release-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderID: lastOrderIdRef.current }),
          }).catch((releaseError) => console.warn("No se pudo liberar la reserva tras el error.", releaseError));
        }
        lastOrderIdRef.current = null;
        setBusy(false);
        setMessage("No se pudo completar el pago. La reserva se liberará al cancelar o al vencer el plazo de checkout.");
      },
    });

    buttonRef.current = buttons;
    buttons.render(container).catch((error) => {
      if (!cancelled) {
        console.error("No se pudieron mostrar los botones de PayPal", error);
        setMessage("No se pudieron cargar los botones de PayPal.");
      }
    });

    return () => {
      cancelled = true;
      const current = buttonRef.current;
      buttonRef.current = null;
      if (current?.close) void current.close();
      container.innerHTML = "";
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkReady, clientId, cartKey]);

  if (!clientId) {
    return <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Falta NEXT_PUBLIC_PAYPAL_CLIENT_ID. No compartas el Secret con el navegador.</p>;
  }

  const sdkSrc = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;

  return (
    <div className="w-full">
      <Script src={sdkSrc} strategy="afterInteractive" onLoad={() => setSdkReady(true)} onError={() => setMessage("No se pudo cargar el SDK de PayPal. Comprueba tu conexión.")} />
      {!sdkReady && <p className="mb-3 text-center text-xs text-black/60">Cargando PayPal…</p>}
      <div ref={containerRef} />
      {busy && <p className="mt-2 text-center text-xs text-black/60">Conectando con PayPal…</p>}
      {message && <p role="status" className="mt-3 rounded border border-black/10 bg-white p-3 text-sm text-black/80">{message}</p>}
      <p className="mt-3 text-center text-[10px] leading-4 text-black/50">Entorno Sandbox: utiliza una cuenta de comprador de prueba. No se realizará un cobro real.</p>
    </div>
  );
}
