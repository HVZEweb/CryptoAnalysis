import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { loginUser } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/request-context";

const authSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(1, "Введите пароль"),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = await checkRateLimit(`auth-login:${ip}`, 10, 15 * 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Слишком много попыток входа" }, { status: 429 });
  }

  try {
    const body = authSchema.parse(await request.json());
    const { user, token } = await loginUser(body.email, body.password);

    const response = NextResponse.json({
      user: { email: user.email, tier: user.tier, predictionsUsed: user.predictionsUsed },
    });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка входа";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
