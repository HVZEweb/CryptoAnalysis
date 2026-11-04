import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loginUser } from "@/lib/auth";
import { authFailure, jsonBody, limitByIp, publicUser, withSession } from "@/lib/auth-http";
import { clientMeta } from "@/lib/request-context";

const schema = z.object({
  email: z.string().trim().min(3, "Введите email").max(254),
  password: z.string().min(1, "Введите пароль").max(1024),
});

export async function POST(request: NextRequest) {
  const limited = await limitByIp(request, "auth-login", 20, 15 * 60_000);
  if (limited) return limited;

  const parsed = schema.safeParse(await jsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Введите email и пароль" }, { status: 400 });

  try {
    const result = await loginUser(parsed.data.email, parsed.data.password, clientMeta(request));
    // Two-step sign-in: the password was right, now the code (POST /api/auth/login/2fa with this challenge).
    if ("twoFactor" in result) return NextResponse.json({ twoFactor: true, challenge: result.twoFactor });
    return withSession({ user: publicUser(result.user) }, result.token, result.expiresAt);
  } catch (error) {
    return authFailure(error, "auth/login");
  }
}
