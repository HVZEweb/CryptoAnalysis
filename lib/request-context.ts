import type { NextRequest } from "next/server";

export const DEVICE_COOKIE = "cap_device";
export const SESSION_COOKIE = "cap_session";

/** Secure cookies need HTTPS; COOKIE_SECURE=false lets a plain-HTTP deployment (IP:port) keep sessions. */
export function secureCookies(): boolean {
  const flag = process.env.COOKIE_SECURE?.trim();
  return flag ? flag === "true" : process.env.NODE_ENV === "production";
}

export function getDeviceId(request: NextRequest): string | undefined {
  return request.cookies.get(DEVICE_COOKIE)?.value;
}

export function getSessionToken(request: NextRequest): string | undefined {
  return request.cookies.get(SESSION_COOKIE)?.value;
}
