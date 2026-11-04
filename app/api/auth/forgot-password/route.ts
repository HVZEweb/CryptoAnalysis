import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPasswordResetToken, isValidEmail, normalizeEmail } from "@/lib/auth";
import { jsonBody, limitByIp } from "@/lib/auth-http";
import { sendPasswordResetEmail } from "@/lib/auth-mail";
import { logAuthEvent } from "@/lib/auth-tokens";
import { mailConfigured } from "@/lib/mailer";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientMeta, publicOrigin } from "@/lib/request-context";

const schema = z.object({ email: z.string().trim().max(254) });

const SENT = "Если такой аккаунт есть, мы отправили на почту ссылку для нового пароля. Она действует 1 час. Проверьте и папку «Спам».";

export async function POST(request: NextRequest) {
  const limited = await limitByIp(request, "auth-forgot", 5, 15 * 60_000);
  if (limited) return limited;

  const parsed = schema.safeParse(await jsonBody(request));
  const email = parsed.success ? normalizeEmail(parsed.data.email) : "";
  if (!isValidEmail(email)) return NextResponse.json({ error: "Некорректный email" }, { status: 400 });

  const dev = process.env.NODE_ENV === "development";
  if (!mailConfigured() && !dev) {
    return NextResponse.json(
      { error: "Восстановление по почте пока не подключено. Напишите администратору — он задаст новый пароль." },
      { status: 503 }
    );
  }

  // At most 3 letters an hour to one address, so the form cannot be used to flood someone's inbox.
  // The answer is the same whether or not the account exists.
  const perEmail = await checkRateLimit(`auth-forgot-email:${email}`, 3, 60 * 60_000);
  if (!perEmail.allowed) return NextResponse.json({ message: SENT });

  try {
    const found = await createPasswordResetToken(email);
    if (!found) return NextResponse.json({ message: SENT });
    await logAuthEvent("reset_requested", { userId: found.user.id, email }, clientMeta(request));
    if (dev && !mailConfigured()) {
      return NextResponse.json({ message: SENT, devResetUrl: `/reset-password?token=${encodeURIComponent(found.token)}` });
    }
    await sendPasswordResetEmail(found.user.email, found.token, publicOrigin(request));
    return NextResponse.json({ message: SENT });
  } catch (error) {
    console.error("[auth/forgot-password]", error);
    return NextResponse.json({ error: "Не удалось отправить письмо, попробуйте позже" }, { status: 500 });
  }
}
