import type { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/rate-limit";
import type { ClientMeta } from "@/lib/sessions";

export const DEVICE_COOKIE = "cap_device";

/** Secure cookies need HTTPS; COOKIE_SECURE=false lets a plain-HTTP deployment (IP:port) keep sessions. */
export function secureCookies(): boolean {
  const flag = process.env.COOKIE_SECURE?.trim();
  return flag ? flag === "true" : process.env.NODE_ENV === "production";
}

/**
 * Over HTTPS the session cookie carries the __Host- prefix: the browser then accepts it only from this exact
 * host, over HTTPS, for the whole site — a neighbouring subdomain or a plain-HTTP page cannot plant or read it.
 */
export function sessionCookieName(): string {
  return secureCookies() ? "__Host-cap_session" : "cap_session";
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: number, now = Date.now()): void {
  response.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    maxAge: Math.max(0, Math.floor((expiresAt - now) / 1000)),
    path: "/",
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(sessionCookieName(), "", { httpOnly: true, secure: secureCookies(), sameSite: "lax", maxAge: 0, path: "/" });
}

export function getDeviceId(request: NextRequest): string | undefined {
  return request.cookies.get(DEVICE_COOKIE)?.value;
}

/** The session token from any request (route handlers get a plain Request in some places). */
export function getSessionToken(request: Request): string | undefined {
  const name = sessionCookieName();
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  if (!match) return undefined;
  try {
    return decodeURIComponent(match.slice(name.length + 1)) || undefined;
  } catch {
    return undefined;
  }
}

export function clientMeta(request: Request): ClientMeta {
  return { ip: getClientIp(request), userAgent: request.headers.get("user-agent") ?? undefined };
}

/** Host the visitor typed: behind the proxies request.url is the internal 127.0.0.1 address. */
export function publicHost(request: Request): string {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
}

export function publicOrigin(request: Request): string {
  const configured = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${proto}://${publicHost(request)}`;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Changes may only come from the site's own pages. Session cookies are SameSite=Lax already; this also refuses
 * a request another site's page sent with fetch or a form (by Sec-Fetch-Site and Origin).
 */
export function isCrossSiteWrite(request: Request): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (origin === "null") return true;
  try {
    return new URL(origin).host !== publicHost(request);
  } catch {
    return true;
  }
}
