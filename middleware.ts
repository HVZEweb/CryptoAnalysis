import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isSitePrivate } from "@/lib/auth";
import { lookupSession } from "@/lib/sessions";
import { DEVICE_COOKIE, clientMeta, getSessionToken, isCrossSiteWrite, publicHost, secureCookies, setSessionCookie } from "@/lib/request-context";

/** Reachable without signing in on a private site: the login page and the auth API itself. */
const PUBLIC_PATHS = [
  "/login",
  "/reset-password",
  "/terms",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/signup-status",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/verify-email",
  "/api/auth/me",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  // Static files from /public (icons, images).
  return /\.[a-z0-9]{2,5}$/i.test(pathname);
}

function withDeviceCookie(request: NextRequest, response: NextResponse): NextResponse {
  if (!request.cookies.get(DEVICE_COOKIE)) {
    response.cookies.set(DEVICE_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60,
      path: "/",
    });
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/api/") && isCrossSiteWrite(request)) {
    return NextResponse.json({ error: "Запрос с чужого сайта отклонён" }, { status: 403 });
  }

  // The session is looked up (and its expiry moved forward) once here; route handlers check it again themselves.
  const token = getSessionToken(request);
  const session = token ? await lookupSession(token, clientMeta(request)).catch(() => null) : null;

  if (isSitePrivate() && !isPublic(pathname) && !session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
    }
    // Build the public URL from the proxy's headers: behind Caddy, request.url is the internal 127.0.0.1 address.
    const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
    const login = new URL(`${proto}://${publicHost(request)}/login`);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return withDeviceCookie(request, NextResponse.redirect(login));
  }

  const response = NextResponse.next();
  if (session?.renewed && token) setSessionCookie(response, token, session.expiresAt);
  return withDeviceCookie(request, response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  // Node.js runtime so the session can be checked against the database.
  runtime: "nodejs",
};
