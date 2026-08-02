import type { NextRequest } from "next/server";

export const DEVICE_COOKIE = "cap_device";
export const SESSION_COOKIE = "cap_session";

export function getDeviceId(request: NextRequest): string | undefined {
  return request.cookies.get(DEVICE_COOKIE)?.value;
}

export function getSessionToken(request: NextRequest): string | undefined {
  return request.cookies.get(SESSION_COOKIE)?.value;
}
