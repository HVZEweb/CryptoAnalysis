import { timingSafeEqual } from "crypto";

const PLACEHOLDER_SECRET = "change_me_admin_secret";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Admin API gate: requires the `x-admin-secret` header to match ADMIN_SECRET.
 * Without a configured secret the gate stays open only outside production (local dev).
 */
export function verifyAdminSecret(request: Request): boolean {
  const secret = process.env.ADMIN_SECRET?.trim();
  if (!secret || secret === PLACEHOLDER_SECRET) {
    return process.env.NODE_ENV !== "production";
  }
  return safeEqual(request.headers.get("x-admin-secret") ?? "", secret);
}

export function verifyWebhookSecret(request: Request): boolean {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = request.headers.get("x-webhook-secret");
  const bodySecret = request.headers.get("x-payment-secret");
  return header === secret || bodySecret === secret;
}
