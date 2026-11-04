import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { findUserById, type UserRecord } from "@/lib/auth";
import { lookupSession, type SessionInfo } from "@/lib/sessions";
import { getSessionToken, sessionCookieName } from "@/lib/request-context";

/** The signed-in user for a session token, or null. */
export async function getSessionUser(token: string | undefined): Promise<UserRecord | null> {
  const session = await lookupSession(token).catch(() => null);
  return session ? findUserById(session.userId).catch(() => null) : null;
}

/** The signed-in user behind an API request together with their session, or null. */
export async function getRequestUser(request: Request): Promise<{ user: UserRecord; session: SessionInfo } | null> {
  const session = await lookupSession(getSessionToken(request)).catch(() => null);
  if (!session) return null;
  const user = await findUserById(session.userId).catch(() => null);
  return user ? { user, session } : null;
}

/** Admin user behind an API request, or null. */
export async function getAdmin(request: Request): Promise<UserRecord | null> {
  const user = await getSessionUser(getSessionToken(request));
  return user?.role === "admin" ? user : null;
}

/** For API routes: `const denied = await denyUnlessAdmin(request); if (denied) return denied;` */
export async function denyUnlessAdmin(request: Request): Promise<NextResponse | null> {
  if (await getAdmin(request)) return null;
  return NextResponse.json({ error: "Доступно только администратору" }, { status: 403 });
}

/** Signed-in user for server components (reads the session cookie), or null. */
export async function getUserFromCookies(): Promise<UserRecord | null> {
  return getSessionUser((await cookies()).get(sessionCookieName())?.value);
}

/** Admin user for server components (reads the session cookie), or null. */
export async function getAdminFromCookies(): Promise<UserRecord | null> {
  const user = await getUserFromCookies();
  return user?.role === "admin" ? user : null;
}
