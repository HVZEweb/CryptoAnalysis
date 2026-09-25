import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { findUserById, getUserIdBySession, type UserRecord } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/request-context";

/** The signed-in user for a session token, or null. */
export async function getSessionUser(token: string | undefined): Promise<UserRecord | null> {
  const userId = await getUserIdBySession(token).catch(() => null);
  return userId ? findUserById(userId).catch(() => null) : null;
}

function sessionTokenFrom(request: Request): string | undefined {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : undefined;
}

/** Admin user behind an API request, or null. */
export async function getAdmin(request: Request): Promise<UserRecord | null> {
  const user = await getSessionUser(sessionTokenFrom(request));
  return user?.role === "admin" ? user : null;
}

/** For API routes: `const denied = await denyUnlessAdmin(request); if (denied) return denied;` */
export async function denyUnlessAdmin(request: Request): Promise<NextResponse | null> {
  if (await getAdmin(request)) return null;
  return NextResponse.json({ error: "Доступно только администратору" }, { status: 403 });
}

/** Admin user for server components (reads the session cookie), or null. */
export async function getAdminFromCookies(): Promise<UserRecord | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  return user?.role === "admin" ? user : null;
}

export function verifyWebhookSecret(request: Request): boolean {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = request.headers.get("x-webhook-secret");
  const bodySecret = request.headers.get("x-payment-secret");
  return header === secret || bodySecret === secret;
}
