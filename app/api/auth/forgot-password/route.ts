import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { createPasswordResetToken } from "@/lib/auth";

const schema = z.object({ email: z.string().email() });

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = await checkRateLimit(`auth-forgot:${ip}`, 5, 15 * 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  }

  try {
    const { email } = schema.parse(await request.json());
    const token = await createPasswordResetToken(email);
    const response: Record<string, string> = {
      message: "Если email зарегистрирован, ссылка для сброса отправлена.",
    };
    if (process.env.NODE_ENV === "development" && token) {
      response.devResetToken = token;
      response.devResetUrl = `/reset-password?token=${token}`;
    }
    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: "Некорректный email" }, { status: 400 });
  }
}
