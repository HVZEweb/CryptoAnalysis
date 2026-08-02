import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { resetPasswordWithToken } from "@/lib/auth";

const schema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, "Минимум 8 символов"),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = await checkRateLimit(`auth-reset:${ip}`, 5, 15 * 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  }

  try {
    const { token, password } = schema.parse(await request.json());
    const ok = await resetPasswordWithToken(token, password);
    if (!ok) return NextResponse.json({ error: "Ссылка недействительна или устарела" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
