/** Local project — admin gate disabled. */

export function verifyAdminSecret(_request: Request): boolean {
  return true;
}

export function verifyWebhookSecret(request: Request): boolean {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = request.headers.get("x-webhook-secret");
  const bodySecret = request.headers.get("x-payment-secret");
  return header === secret || bodySecret === secret;
}
