import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const ADMIN_COOKIE_NAME = "shifu_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;

function secret() {
  const value = process.env.ADMIN_SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET debe tener al menos 32 caracteres");
  }
  return value;
}

function signature(expires: string) {
  return createHmac("sha256", secret()).update(expires).digest("base64url");
}

export function safeStringEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createAdminSession() {
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  return { token: `${expires}.${signature(expires)}`, maxAge: SESSION_SECONDS };
}

export function isAdminAuthenticated(request: NextRequest) {
  try {
    const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
    if (!token) return false;
    const [expires, suppliedSignature, extra] = token.split(".");
    if (!expires || !suppliedSignature || extra !== undefined) return false;
    if (!/^\d{10}$/.test(expires) || Number(expires) <= Math.floor(Date.now() / 1000)) return false;
    return safeStringEqual(suppliedSignature, signature(expires));
  } catch {
    return false;
  }
}

export function adminPasswordMatches(value: unknown) {
  const configured = process.env.ADMIN_PANEL_PASSWORD;
  if (!configured || typeof value !== "string") return false;
  return safeStringEqual(value, configured);
}
