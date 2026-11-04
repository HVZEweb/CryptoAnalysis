import { NextResponse } from "next/server";
import { hasPaidAccess, recoveryCodesLeft } from "@/lib/auth";
import { getRequestUser } from "@/lib/admin-auth";
import { publicUser } from "@/lib/auth-http";
import { recentAuthEvents } from "@/lib/auth-tokens";
import { mailConfigured } from "@/lib/mailer";
import { deviceLabel, listSessions } from "@/lib/sessions";

export const dynamic = "force-dynamic";

/** The account page: profile, subscription, signed-in devices and recent sign-in activity. */
export async function GET(request: Request) {
  const me = await getRequestUser(request);
  if (!me) return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
  const { user, session } = me;
  const [sessions, events, codesLeft] = await Promise.all([
    listSessions(user.id),
    recentAuthEvents(user.id, 15),
    user.twoFactor ? recoveryCodesLeft(user.id) : Promise.resolve(0),
  ]);
  return NextResponse.json({
    user: {
      ...publicUser(user),
      createdAt: user.createdAt,
      paid: hasPaidAccess(user),
      paidUntil: user.paidUntil,
      permanent: user.role === "admin" || user.tier === "paid",
      recoveryCodesLeft: codesLeft,
    },
    mail: mailConfigured(),
    sessions: sessions.map((s) => ({
      id: s.id,
      current: s.id === session.id,
      device: deviceLabel(s.userAgent),
      ip: s.ip,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
    })),
    events: events.map((e) => ({ type: e.type, at: e.at, ip: e.ip, device: deviceLabel(e.userAgent) })),
  });
}
