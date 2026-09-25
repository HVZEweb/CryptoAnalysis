import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUserIdBySession, isSitePrivate } from "@/lib/auth";
import { DEVICE_COOKIE, SESSION_COOKIE, secureCookies } from "@/lib/request-context";

/** Reachable without signing in on a private site: the login page and the auth API itself. */
const PUBLIC_PATHS = [
  "/login",
  "/reset-password",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/signup-status",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/me",
  "/api/webhooks/payment",
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

  if (isSitePrivate() && !isPublic(pathname)) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const userId = token ? await getUserIdBySession(token).catch(() => null) : null;
    if (!userId) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
      }
      // Build the public URL from the proxy's headers: behind Caddy, request.url is the internal 127.0.0.1 address.
      const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
      const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
      const login = new URL(`${proto}://${host}/login`);
      if (pathname !== "/") login.searchParams.set("next", pathname + search);
      return withDeviceCookie(request, NextResponse.redirect(login));
    }
  }

  return withDeviceCookie(request, NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  // Node.js runtime so the session can be checked against the database.
  runtime: "nodejs",
};
