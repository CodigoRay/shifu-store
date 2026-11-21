import { randomUUID } from "node:crypto";

type EmailType = "order_confirmed" | "order_shipped" | "order_delivered";
type DbClient = any;

type OrderEmailStatus = {
  status: "sent" | "already_sent" | "already_processing" | "skipped" | "failed";
  reason?: string;
};

type EmailOrder = {
  id: string;
  order_number: string;
  guest_email: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  total: number | string;
  currency: string | null;
  shipping_carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
};

type EmailItem = {
  product_name: string;
  variant_label?: string | null;
  quantity: number;
  unit_price: number | string;
  line_total: number | string;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char] ?? char;
  });
}

function validCurrency(value: string | null): string {
  return value && /^[A-Z]{3}$/.test(value) ? value : "USD";
}

function money(value: number | string, currency: string): string {
  const amount = Number(value);
  return new Intl.NumberFormat(currency === "COP" ? "es-CO" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function safeTrackingUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function getSiteUrl(): string {
  const raw = process.env.STORE_URL || "https://maestroshifu.shop";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
      return "https://maestroshifu.shop";
    }
    return url.origin;
  } catch {
    return "https://maestroshifu.shop";
  }
}

function buildEmail(type: EmailType, order: EmailOrder, items: EmailItem[]) {
  const currency = validCurrency(order.currency);
  const firstName = (order.customer_first_name || "Hola").trim();
  const orderNumber = escapeHtml(order.order_number);
  const itemRows = items.map((item) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #eee;color:#242424;font-size:14px;">
        ${escapeHtml(item.product_name)}${item.variant_label ? ` <span style="color:#777;">(${escapeHtml(item.variant_label)})</span>` : ""} <span style="color:#777;">× ${Number(item.quantity) || 0}</span>
      </td>
      <td align="right" style="padding:12px 0;border-bottom:1px solid #eee;color:#242424;font-size:14px;font-weight:700;white-space:nowrap;">
        ${escapeHtml(money(item.line_total, currency))}
      </td>
    </tr>`).join("");

  const trackingUrl = safeTrackingUrl(order.tracking_url);
  const trackingBlock = `
    <div style="margin:22px 0;padding:18px;background:#f7f2ff;border:1px solid #e4d8ff;">
      <p style="margin:0 0 8px;font-size:11px;letter-spacing:1.5px;font-weight:700;color:#7555b5;">DATOS DE ENVÍO</p>
      <p style="margin:5px 0;font-size:14px;color:#242424;"><strong>Transportadora:</strong> ${escapeHtml(order.shipping_carrier || "Por confirmar")}</p>
      <p style="margin:5px 0;font-size:14px;color:#242424;"><strong>Número de guía:</strong> ${escapeHtml(order.tracking_number || "Por confirmar")}</p>
      ${trackingUrl ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(trackingUrl)}" style="display:inline-block;background:#171717;color:#fff;padding:12px 18px;text-decoration:none;font-size:11px;font-weight:700;letter-spacing:1px;">RASTREAR MI PEDIDO</a></p>` : ""}
    </div>`;

  let subject = `Shifu Club · Confirmación de pedido ${order.order_number}`;
  let heading = "¡Gracias por tu compra!";
  let intro = `Hola ${escapeHtml(firstName)}, recibimos tu pago y tu pedido ya está registrado.`;
  let body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#555;">${intro}</p>
      <div style="padding:18px;border:1px solid #e8e5e0;background:#fff;">
        <p style="margin:0 0 14px;font-size:10px;letter-spacing:1.5px;color:#888;">RESUMEN DEL PEDIDO</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tbody>${itemRows}</tbody></table>
        <div style="display:flex;justify-content:space-between;padding-top:16px;font-size:15px;font-weight:700;color:#171717;"><span>Total pagado</span><span>${escapeHtml(money(order.total, currency))}</span></div>
      </div>
      <p style="margin:18px 0;font-size:13px;color:#666;">Tu número de pedido es <strong style="color:#171717;">${orderNumber}</strong>. Guarda esta referencia para consultar el avance de tu compra.</p>
      <p style="margin:22px 0;"><a href="${escapeHtml(getSiteUrl())}/seguimiento" style="display:inline-block;background:#171717;color:#fff;padding:13px 20px;text-decoration:none;font-size:11px;font-weight:700;letter-spacing:1px;">CONSULTAR MI PEDIDO</a></p>`;

  if (type === "order_shipped") {
    subject = `Shifu Club · Tu pedido ${order.order_number} está en camino`;
    heading = "¡Tu pedido fue enviado!";
    intro = `Hola ${escapeHtml(firstName)}, tu pedido ya salió y está en camino. Aquí tienes los datos para rastrearlo.`;
    body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#555;">${intro}</p>
      ${trackingBlock}
      <p style="margin:18px 0;font-size:13px;color:#666;">Número de pedido: <strong style="color:#171717;">${orderNumber}</strong></p>
      <p style="margin:22px 0;"><a href="${escapeHtml(getSiteUrl())}/seguimiento" style="display:inline-block;background:#171717;color:#fff;padding:13px 20px;text-decoration:none;font-size:11px;font-weight:700;letter-spacing:1px;">VER ESTADO DEL PEDIDO</a></p>`;
  } else if (type === "order_delivered") {
    subject = `Shifu Club · Pedido ${order.order_number} entregado`;
    heading = "¡Tu pedido figura como entregado!";
    intro = `Hola ${escapeHtml(firstName)}, hemos actualizado tu pedido como entregado. ¡Esperamos que disfrutes tu compra!`;
    body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#555;">${intro}</p>
      <div style="margin:20px 0;padding:18px;background:#f7f2ff;border:1px solid #e4d8ff;">
        <p style="margin:0;font-size:11px;letter-spacing:1.5px;font-weight:700;color:#7555b5;">PEDIDO ENTREGADO</p>
        <p style="margin:10px 0 0;font-size:18px;font-weight:800;color:#171717;">${orderNumber}</p>
      </div>
      <p style="margin:22px 0;"><a href="${escapeHtml(getSiteUrl())}/seguimiento" style="display:inline-block;background:#171717;color:#fff;padding:13px 20px;text-decoration:none;font-size:11px;font-weight:700;letter-spacing:1px;">CONSULTAR MI PEDIDO</a></p>`;
  }

  const html = `<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:28px 12px;background:#f5f3ef;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:600px;margin:0 auto;background:#fffefa;padding:30px 26px;">
      <p style="margin:0;text-align:center;font-size:13px;font-weight:800;letter-spacing:4px;color:#171717;">SHIFU CLUB ✳</p>
      <p style="margin:10px 0 24px;text-align:center;font-size:9px;letter-spacing:3px;color:#7555b5;">FANS PARA FANS</p>
      <div style="height:1px;background:#e9e5df;"></div>
      <h1 style="margin:28px 0 16px;font-size:26px;line-height:1.2;color:#171717;">${heading}</h1>
      ${body}
      <div style="height:1px;background:#e9e5df;margin:28px 0 18px;"></div>
      <p style="margin:0;text-align:center;font-size:11px;line-height:1.7;color:#888;">Shifu Club · Fans para fans.<br>Este es un mensaje automático relacionado con tu compra.</p>
    </div></body></html>`;

  const text = `${heading}\n\n${intro.replace(/<[^>]*>/g, "")}\n\nPedido: ${order.order_number}\nTotal: ${money(order.total, currency)}\n\nConsulta tu pedido: ${getSiteUrl()}/seguimiento`;
  return { subject, html, text };
}

async function claimNotification(db: DbClient, orderId: string, type: EmailType, recipient: string) {
  const claimToken = randomUUID();
  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await db.from("order_email_notifications")
    .insert({ order_id: orderId, notification_type: type, recipient_email: recipient, status: "processing", attempts: 1, claim_token: claimToken, updated_at: now })
    .select("id,claim_token,status")
    .single();

  if (!insertError && inserted) return { id: inserted.id as string, claimToken };
  if (insertError?.code !== "23505") {
    throw new Error(`No se pudo reservar la notificación (${insertError?.code || "DB"}). Ejecuta la migración 003-email-notifications.sql.`);
  }

  const { data: existing, error: lookupError } = await db.from("order_email_notifications")
    .select("id,status,attempts,updated_at")
    .eq("order_id", orderId)
    .eq("notification_type", type)
    .single();
  if (lookupError || !existing) throw new Error("No se pudo consultar el estado de la notificación.");
  if (existing.status === "sent") return { existing: "sent" as const };

  const reclaim = existing.status === "failed" || (existing.status === "processing" && Date.now() - new Date(existing.updated_at).getTime() > 10 * 60 * 1000);
  if (!reclaim) return { existing: "processing" as const };

  let query = db.from("order_email_notifications").update({
    status: "processing",
    recipient_email: recipient,
    attempts: Number(existing.attempts || 0) + 1,
    claim_token: claimToken,
    error_message: null,
    updated_at: now,
  }).eq("id", existing.id);
  if (existing.status === "failed") query = query.eq("status", "failed");
  else query = query.eq("status", "processing").lt("updated_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
  const { data: reclaimed, error: reclaimError } = await query.select("id").maybeSingle();
  if (reclaimError) throw new Error("No se pudo reintentar la notificación.");
  if (!reclaimed) return { existing: "processing" as const };
  return { id: reclaimed.id as string, claimToken };
}

export async function sendOrderEmailNotification(db: DbClient, orderId: string, type: EmailType): Promise<OrderEmailStatus> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn(`Email ${type} no enviado: configura RESEND_API_KEY y EMAIL_FROM.`);
    return { status: "skipped", reason: "email_not_configured" };
  }

  let claim: Awaited<ReturnType<typeof claimNotification>> | null = null;
  try {
    const { data: order, error: orderError } = await db.from("orders")
      .select("id,order_number,guest_email,customer_first_name,customer_last_name,total,currency,shipping_carrier,tracking_number,tracking_url")
      .eq("id", orderId).single();
    if (orderError || !order) throw new Error("No se encontró el pedido para preparar el correo.");
    const email = String(order.guest_email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: "skipped", reason: "invalid_customer_email" };

    const { data: items, error: itemsError } = await db.from("order_items")
      .select("product_name,variant_label,quantity,unit_price,line_total")
      .eq("order_id", orderId);
    if (itemsError) throw new Error("No se pudieron consultar los productos del pedido.");

    claim = await claimNotification(db, orderId, type, email);
    if ("existing" in claim) {
      return { status: claim.existing === "sent" ? "already_sent" : "already_processing" };
    }

    const message = buildEmail(type, order as EmailOrder, (items ?? []) as EmailItem[]);
    const idempotencyKey = `shifu-${type}-${orderId}`.slice(0, 240);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ from, to: [email], subject: message.subject, html: message.html, text: message.text }),
      cache: "no-store",
    });
    const responseBody = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
    if (!response.ok || !responseBody.id) {
      const reason = String(responseBody.message || responseBody.name || `Resend respondió HTTP ${response.status}`).slice(0, 900);
      await db.from("order_email_notifications").update({ status: "failed", error_message: reason, updated_at: new Date().toISOString() }).eq("id", claim.id).eq("claim_token", claim.claimToken);
      console.error(`Email ${type} falló para ${order.order_number}: ${reason}`);
      return { status: "failed", reason };
    }

    const { error: savedError } = await db.from("order_email_notifications").update({
      status: "sent",
      provider: "resend",
      provider_message_id: responseBody.id,
      sent_at: new Date().toISOString(),
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("id", claim.id).eq("claim_token", claim.claimToken);
    if (savedError) console.error(`Resend aceptó el correo ${responseBody.id}, pero no se guardó el resultado local.`, savedError.code);
    return { status: "sent" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Error desconocido al enviar el correo.";
    if (claim && "id" in claim) {
      await db.from("order_email_notifications").update({ status: "failed", error_message: reason.slice(0, 900), updated_at: new Date().toISOString() }).eq("id", claim.id).eq("claim_token", claim.claimToken);
    }
    console.error(`Email ${type} no enviado:`, reason);
    return { status: "failed", reason };
  }
}
