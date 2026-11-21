import { NextResponse } from "next/server";
import { createVerify } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { sendOrderEmailNotification } from "@/lib/order-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAYPAL_API = "https://api-m.paypal.com";

type PayPalEvent = {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    status?: string;
    amount?: { value?: string; currency_code?: string };
    supplementary_data?: { related_ids?: { order_id?: string; capture_id?: string } };
  };
};

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase server credentials are not configured");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const certificateCache = new Map<string, { pem: string; expiresAt: number }>();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function getPayPalCertificate(certUrl: string): Promise<string> {
  const parsed = new URL(certUrl);
  const allowedHosts = new Set(["api-m.paypal.com", "api.paypal.com"]);
  if (
    parsed.protocol !== "https:" ||
    !allowedHosts.has(parsed.hostname) ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    !parsed.pathname.startsWith("/v1/notifications/certs/")
  ) {
    throw new Error("PayPal certificate URL is not trusted");
  }

  const cached = certificateCache.get(certUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.pem;

  const response = await fetch(certUrl, { cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error(`Could not retrieve PayPal certificate (${response.status})`);
  const pem = await response.text();
  if (!pem.includes("BEGIN CERTIFICATE") || pem.length > 100_000) {
    throw new Error("PayPal certificate response is invalid");
  }
  certificateCache.set(certUrl, { pem, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
  return pem;
}

async function verifyPayPalSignature(rawBody: string, request: Request): Promise<boolean> {
  const webhookId = process.env.PAYPAL_LIVE_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_LIVE_WEBHOOK_ID is not configured yet");

  const transmissionId = request.headers.get("paypal-transmission-id");
  const transmissionTime = request.headers.get("paypal-transmission-time");
  const transmissionSig = request.headers.get("paypal-transmission-sig");
  const certUrl = request.headers.get("paypal-cert-url");
  const authAlgo = request.headers.get("paypal-auth-algo");

  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || authAlgo !== "SHA256withRSA") {
    return false;
  }

  const crc = crc32(Buffer.from(rawBody, "utf8"));
  const signedMessage = `${transmissionId}|${transmissionTime}|${webhookId}|${crc}`;
  const certificate = await getPayPalCertificate(certUrl);
  const verifier = createVerify("SHA256");
  verifier.update(signedMessage, "utf8");
  verifier.end();
  return verifier.verify(certificate, Buffer.from(transmissionSig, "base64"));
}

function getPayPalOrderId(event: PayPalEvent): string | null {
  return event.resource?.supplementary_data?.related_ids?.order_id || null;
}

async function markOrderPaymentFailed(db: ReturnType<typeof adminDb>, paypalOrderId: string, reason: string) {
  const { data: order, error } = await db.from("orders")
    .select("id,payment_status")
    .eq("paypal_order_id", paypalOrderId)
    .maybeSingle();
  if (error) throw new Error("Could not find local order for failed PayPal event");
  if (!order || order.payment_status === "completed") return "ignored";

  const { error: releaseError } = await db.rpc("release_order_inventory_reservation", { p_order_id: order.id });
  if (releaseError) throw new Error(`Could not release inventory reservation (${releaseError.code})`);

  const { error: updateError } = await db.from("orders")
    .update({ status: "cancelled", payment_status: "failed" })
    .eq("id", order.id)
    .neq("payment_status", "completed");
  if (updateError) throw new Error("Could not update failed PayPal order");

  await db.from("order_events").insert({
    order_id: order.id,
    event_type: "payment_failed_webhook",
    description: reason.slice(0, 500),
  });
  return "processed";
}

async function processCaptureCompleted(db: ReturnType<typeof adminDb>, event: PayPalEvent) {
  const resource = event.resource;
  const paypalOrderId = getPayPalOrderId(event);
  const captureId = resource?.id;
  const amount = resource?.amount;
  if (!paypalOrderId || !captureId || resource?.status !== "COMPLETED" || !amount?.value || !amount.currency_code) {
    throw new Error("Completed capture event is missing required payment fields");
  }

  const { data: order, error: orderError } = await db.from("orders")
    .select("id,order_number,total,currency,payment_status,paypal_capture_id")
    .eq("paypal_order_id", paypalOrderId)
    .maybeSingle();
  if (orderError) throw new Error("Could not query the Shifu order for this capture");
  if (!order) return "ignored";

  if (amount.currency_code !== order.currency || amount.value !== Number(order.total).toFixed(2)) {
    throw new Error(`PayPal capture amount/currency mismatch for ${order.order_number}`);
  }
  if (order.paypal_capture_id && order.paypal_capture_id !== captureId) {
    throw new Error(`PayPal capture ID mismatch for ${order.order_number}`);
  }

  // This RPC is idempotent: when the checkout capture route already consumed
  // the reservation, replaying the webhook does not decrement inventory again.
  const { error: inventoryError } = await db.rpc("consume_order_inventory_reservation", {
    p_order_id: order.id,
  });
  if (inventoryError) throw new Error(`Inventory reconciliation failed (${inventoryError.code})`);

  const now = new Date().toISOString();
  const { error: updateError } = await db.from("orders")
    .update({
      status: "paid",
      payment_status: "completed",
      fulfillment_status: "pending",
      paypal_capture_id: captureId,
      paid_at: order.payment_status === "completed" ? undefined : now,
    })
    .eq("id", order.id)
    .neq("payment_status", "completed");
  if (updateError) throw new Error("Could not mark Shifu order as paid");

  const { error: paymentError } = await db.from("payments").upsert({
    order_id: order.id,
    provider: "paypal",
    provider_order_id: paypalOrderId,
    provider_capture_id: captureId,
    status: "completed",
    amount: order.total,
    currency: order.currency,
  }, { onConflict: "provider_capture_id" });
  if (paymentError) throw new Error("Could not persist PayPal capture record");

  await db.from("order_events").insert({
    order_id: order.id,
    event_type: "payment_completed_webhook",
    description: `PayPal Live webhook confirmed capture ${captureId}.`,
  });

  const email = await sendOrderEmailNotification(db, order.id, "order_confirmed");
  return email.status === "failed" ? "processed_email_failed" : "processed";
}

async function processEvent(db: ReturnType<typeof adminDb>, event: PayPalEvent) {
  const type = event.event_type || "";
  const paypalOrderId = getPayPalOrderId(event);
  const resourceId = event.resource?.id || null;

  switch (type) {
    case "PAYMENT.CAPTURE.COMPLETED":
      return processCaptureCompleted(db, event);

    case "PAYMENT.CAPTURE.PENDING":
      return "processed"; // Never fulfill an order while PayPal reports pending funds.

    case "PAYMENT.CAPTURE.DENIED":
      return paypalOrderId
        ? markOrderPaymentFailed(db, paypalOrderId, `PayPal denied capture ${resourceId || "unknown"}.`)
        : "ignored";

    case "CHECKOUT.PAYMENT-APPROVAL.REVERSED":
      return paypalOrderId
        ? markOrderPaymentFailed(db, paypalOrderId, "PayPal reversed checkout payment approval.")
        : "ignored";

    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED": {
      const relatedCaptureId = event.resource?.supplementary_data?.related_ids?.capture_id || resourceId;
      if (!relatedCaptureId) return "ignored";
      const { data: payment, error: paymentLookupError } = await db.from("payments")
        .select("order_id,provider_capture_id")
        .eq("provider_capture_id", relatedCaptureId)
        .maybeSingle();
      if (paymentLookupError) throw new Error("Could not find local payment for refund/reversal event");
      if (!payment) return "ignored";

      const newPaymentStatus = type === "PAYMENT.CAPTURE.REFUNDED" ? "refunded" : "reversed";
      const { error: paymentUpdateError } = await db.from("payments")
        .update({ status: newPaymentStatus })
        .eq("provider_capture_id", relatedCaptureId);
      if (paymentUpdateError) throw new Error("Could not update local payment status");
      const { error: orderUpdateError } = await db.from("orders")
        .update({ payment_status: newPaymentStatus })
        .eq("id", payment.order_id);
      if (orderUpdateError) throw new Error("Could not update local order payment status");
      await db.from("order_events").insert({
        order_id: payment.order_id,
        event_type: type === "PAYMENT.CAPTURE.REFUNDED" ? "payment_refunded_webhook" : "payment_reversed_webhook",
        description: `PayPal reported ${type} for capture ${relatedCaptureId}. Inventory was not automatically restocked.`,
      });
      return "processed";
    }

    default:
      return "ignored";
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "paypal-live-webhook",
    signatureVerification: "PayPal certificate / RSA-SHA256",
    webhookIdConfigured: Boolean(process.env.PAYPAL_LIVE_WEBHOOK_ID),
  });
}

export async function POST(request: Request) {
  let event: PayPalEvent;
  const rawBody = await request.text();
  try {
    event = JSON.parse(rawBody) as PayPalEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!event.id || !event.event_type) {
    return NextResponse.json({ error: "Missing PayPal event ID/type" }, { status: 400 });
  }

  try {
    const valid = await verifyPayPalSignature(rawBody, request);
    if (!valid) return NextResponse.json({ error: "Invalid PayPal webhook signature" }, { status: 400 });

    const db = adminDb();
    const paypalOrderId = getPayPalOrderId(event);
    const resourceId = event.resource?.id || null;
    const { error: insertError } = await db.from("paypal_webhook_events").insert({
      event_id: event.id,
      event_type: event.event_type,
      resource_id: resourceId,
      paypal_order_id: paypalOrderId,
      status: "received",
    });
    if (insertError && insertError.code !== "23505") {
      throw new Error("Could not persist PayPal webhook event");
    }

    const { data: claimed, error: claimError } = await db.rpc("claim_paypal_webhook_event", {
      p_event_id: event.id,
    });
    if (claimError) throw new Error("Could not claim PayPal webhook event");
    if (!claimed) {
      const { data: existing, error: existingError } = await db.from("paypal_webhook_events")
        .select("status")
        .eq("event_id", event.id)
        .single();
      if (existingError) throw new Error("Could not check duplicate PayPal webhook event");
      if (existing.status === "processed" || existing.status === "ignored") {
        return NextResponse.json({ received: true, duplicate: true });
      }
      return NextResponse.json({ error: "Webhook event is already being processed; retry later" }, { status: 503 });
    }

    try {
      const result = await processEvent(db, event);
      const finalStatus = result === "ignored" ? "ignored" : "processed";
      await db.from("paypal_webhook_events").update({
        status: finalStatus,
        processed_at: new Date().toISOString(),
        last_error: null,
      }).eq("event_id", event.id);
      return NextResponse.json({ received: true, status: finalStatus });
    } catch (processingError) {
      const message = processingError instanceof Error ? processingError.message : "Unknown event processing error";
      await db.from("paypal_webhook_events").update({
        status: "failed",
        last_error: message.slice(0, 900),
      }).eq("event_id", event.id);
      console.error("PayPal webhook processing failed:", message);
      return NextResponse.json({ error: "Webhook processing failed; PayPal may retry" }, { status: 500 });
    }
  } catch (error) {
    console.error("PayPal webhook rejected:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "PayPal webhook verification or processing setup failed" }, { status: 500 });
  }
}
