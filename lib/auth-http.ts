import { NextResponse } from "next/server";
import { AuthError, hasPaidAccess, type UserRecord } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { setSessionCookie } from "@/lib/request-context";

/** What the browser may know about the signed-in user. */
export function publicUser(user: UserRecord) {
  return {
    email: user.email,
    tier: hasPaidAccess(user) ? ("paid" as const) : ("registered" as const),
    role: user.role,
    predictionsUsed: user.predictionsUsed,
    emailVerified: user.emailVerifiedAt != null,
    twoFactor: user.twoFactor,
  };
}

/** A JSON answer that also starts the session in this browser. */
export function withSession(body: unknown, token: string, expiresAt: number): NextResponse {
  const response = NextResponse.json(body);
  setSessionCookie(response, token, expiresAt);
  return response;
}

/** AuthError → its message and status; anything else → a generic 500 (details only in the log). */
export function authFailure(error: unknown, where: string): NextResponse {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`[${where}]`, error);
  return NextResponse.json({ error: "Сервис входа временно недоступен, попробуйте позже" }, { status: 500 });
}

/** Per-address limit for an auth endpoint: null when allowed, else a 429 answer. */
export async function limitByIp(request: Request, name: string, limit: number, windowMs: number): Promise<NextResponse | null> {
  const rate = await checkRateLimit(`${name}:${getClientIp(request)}`, limit, windowMs);
  if (rate.allowed) return null;
  return NextResponse.json(
    { error: `Слишком много попыток. Подождите ${Math.ceil(rate.retryAfterSec / 60)} мин.` },
    { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
  );
}

/** The JSON body, or null if it is not JSON (the route then answers 400). */
export async function jsonBody(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
