import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resetPasswordWithToken } from "@/lib/auth";
import { authFailure, jsonBody, limitByIp } from "@/lib/auth-http";
import { clientMeta } from "@/lib/request-context";

const schema = z.object({
  token: z.string().min(20).max(128),
  password: z.string().min(1, "Введите новый пароль").max(1024),
});

export async function POST(request: NextRequest) {
  const limited = await limitByIp(request, "auth-reset", 10, 15 * 60_000);
  if (limited) return limited;

  const parsed = schema.safeParse(await jsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректный запрос" }, { status: 400 });

  try {
    const ok = await resetPasswordWithToken(parsed.data.token, parsed.data.password, clientMeta(request));
    if (!ok) return NextResponse.json({ error: "Ссылка недействительна или устарела — запросите новую" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authFailure(error, "auth/reset-password");
  }
}
