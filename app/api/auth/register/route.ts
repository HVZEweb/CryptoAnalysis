import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isSignupOpen, registerUser } from "@/lib/auth";
import { authFailure, jsonBody, limitByIp, publicUser, withSession } from "@/lib/auth-http";
import { sendVerificationEmail } from "@/lib/auth-mail";
import { DEVICE_COOKIE, clientMeta, publicOrigin } from "@/lib/request-context";

const schema = z.object({
  email: z.string().trim().min(3, "Введите email").max(254),
  password: z.string().min(1, "Введите пароль").max(1024),
});

export async function POST(request: NextRequest) {
  const limited = await limitByIp(request, "auth-register", 5, 60 * 60_000);
  if (limited) return limited;

  if (!(await isSignupOpen().catch(() => false))) {
    return NextResponse.json({ error: "Регистрация закрыта. Попросите администратора добавить вас." }, { status: 403 });
  }

  const parsed = schema.safeParse(await jsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Введите email и пароль" }, { status: 400 });

  try {
    const deviceId = request.cookies.get(DEVICE_COOKIE)?.value;
    const { user, token, expiresAt } = await registerUser(parsed.data.email, parsed.data.password, deviceId, clientMeta(request));
    const verificationSent = await sendVerificationEmail(user, publicOrigin(request));
    return withSession({ user: publicUser(user), verificationSent }, token, expiresAt);
  } catch (error) {
    return authFailure(error, "auth/register");
  }
}
