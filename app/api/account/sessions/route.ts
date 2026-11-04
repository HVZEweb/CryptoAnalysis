import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestUser } from "@/lib/admin-auth";
import { jsonBody } from "@/lib/auth-http";
import { logAuthEvent } from "@/lib/auth-tokens";
import { revokeSessionById, revokeUserSessions } from "@/lib/sessions";
import { clientMeta } from "@/lib/request-context";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke"), id: z.string().length(64) }),
  z.object({ action: z.literal("revoke-others") }),
]);

/** Sign out one of your devices, or all of them except this one. */
export async function POST(request: Request) {
  const me = await getRequestUser(request);
  if (!me) return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
  const parsed = schema.safeParse(await jsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });

  if (parsed.data.action === "revoke") {
    if (parsed.data.id === me.session.id) return NextResponse.json({ error: "Чтобы выйти на этом устройстве, нажмите «Выйти»" }, { status: 400 });
    const ok = await revokeSessionById(me.user.id, parsed.data.id);
    if (!ok) return NextResponse.json({ error: "Сеанс уже завершён" }, { status: 404 });
  } else {
    await revokeUserSessions(me.user.id, me.session.id);
  }
  await logAuthEvent("sessions_revoked", { userId: me.user.id, email: me.user.email }, clientMeta(request));
  return NextResponse.json({ ok: true });
}
