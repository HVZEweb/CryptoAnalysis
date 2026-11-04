import { NextResponse } from "next/server";
import { z } from "zod";
import { changePassword } from "@/lib/auth";
import { getRequestUser } from "@/lib/admin-auth";
import { authFailure, jsonBody, limitByIp } from "@/lib/auth-http";
import { clientMeta } from "@/lib/request-context";

const schema = z.object({
  current: z.string().min(1, "Введите текущий пароль").max(1024),
  password: z.string().min(1, "Введите новый пароль").max(1024),
});

/** Password change: needs the current password; every other device is signed out. */
export async function POST(request: Request) {
  const me = await getRequestUser(request);
  if (!me) return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
  const limited = await limitByIp(request, "account-password", 10, 15 * 60_000);
  if (limited) return limited;

  const parsed = schema.safeParse(await jsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректный запрос" }, { status: 400 });
  try {
    await changePassword(me.user.id, parsed.data.current, parsed.data.password, me.session.id, clientMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authFailure(error, "account/password");
  }
}
