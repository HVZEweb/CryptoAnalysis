import type { NextRequest } from "next/server";
import { findUserById, getUserIdBySession, hasPaidAccess, type UserRecord } from "@/lib/auth";
import { getSessionToken } from "@/lib/request-context";

/** Who is asking: signed in or not, and whether their subscription (or an admin role) gives paid access. */
export async function accessOf(request: NextRequest): Promise<{ user: UserRecord | null; paid: boolean; admin: boolean }> {
  const userId = await getUserIdBySession(getSessionToken(request));
  const user = userId ? await findUserById(userId) : null;
  return { user, paid: !!user && hasPaidAccess(user), admin: user?.role === "admin" };
}
