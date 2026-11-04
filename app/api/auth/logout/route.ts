import { NextResponse } from "next/server";
import { logAuthEvent } from "@/lib/auth-tokens";
import { lookupSession, deleteSession } from "@/lib/sessions";
import { clearSessionCookie, clientMeta, getSessionToken } from "@/lib/request-context";

export async function POST(request: Request) {
  const token = getSessionToken(request);
  if (token) {
    const session = await lookupSession(token).catch(() => null);
    await deleteSession(token).catch(() => undefined);
    if (session) await logAuthEvent("logout", { userId: session.userId }, clientMeta(request));
  }
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
