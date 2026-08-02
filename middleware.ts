import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DEVICE_COOKIE } from "@/lib/request-context";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  if (!request.cookies.get(DEVICE_COOKIE)) {
    response.cookies.set(DEVICE_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60,
      path: "/",
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
