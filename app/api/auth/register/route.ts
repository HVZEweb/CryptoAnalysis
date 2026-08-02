import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { registerUser } from "@/lib/auth";
import { DEVICE_COOKIE, SESSION_COOKIE } from "@/lib/request-context";

const authSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(8, "Минимум 8 символов"),
});

function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = await checkRateLimit(`auth-register:${ip}`, 5, 60 * 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Слишком много регистраций" }, { status: 429 });
  }

  try {
    const body = authSchema.parse(await request.json());
    const deviceId = request.cookies.get(DEVICE_COOKIE)?.value;
    const { user, token } = await registerUser(body.email, body.password, deviceId);

    const response = NextResponse.json({
      user: { email: user.email, tier: user.tier, predictionsUsed: user.predictionsUsed },
    });
    setSessionCookie(response, token);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка регистрации";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
