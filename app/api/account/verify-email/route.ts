import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/admin-auth";
import { sendVerificationEmail } from "@/lib/auth-mail";
import { mailConfigured } from "@/lib/mailer";
import { checkRateLimit } from "@/lib/rate-limit";
import { publicOrigin } from "@/lib/request-context";

/** Sends the confirmation link again (at most 3 times an hour). */
export async function POST(request: Request) {
  const me = await getRequestUser(request);
  if (!me) return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
  if (me.user.emailVerifiedAt != null) return NextResponse.json({ ok: true, already: true });
  if (!mailConfigured()) return NextResponse.json({ error: "Отправка писем пока не подключена" }, { status: 503 });
  const rate = await checkRateLimit(`account-verify:${me.user.id}`, 3, 60 * 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Письмо уже отправлено, проверьте почту и папку «Спам»" }, { status: 429 });
  if (!(await sendVerificationEmail(me.user, publicOrigin(request)))) {
    return NextResponse.json({ error: "Не удалось отправить письмо, попробуйте позже" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
