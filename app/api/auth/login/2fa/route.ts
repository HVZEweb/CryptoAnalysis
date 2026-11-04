import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loginSecondStep } from "@/lib/auth";
import { authFailure, jsonBody, limitByIp, publicUser, withSession } from "@/lib/auth-http";
import { clientMeta } from "@/lib/request-context";

const schema = z.object({
  challenge: z.string().min(20).max(128),
  code: z.string().trim().min(6, "Введите код").max(32),
});

/** Second sign-in step: the code from the authenticator app, or a recovery code. */
export async function POST(request: NextRequest) {
  const limited = await limitByIp(request, "auth-2fa", 20, 15 * 60_000);
  if (limited) return limited;

  const parsed = schema.safeParse(await jsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Введите код" }, { status: 400 });

  try {
    const { user, token, expiresAt } = await loginSecondStep(parsed.data.challenge, parsed.data.code, clientMeta(request));
    return withSession({ user: publicUser(user) }, token, expiresAt);
  } catch (error) {
    return authFailure(error, "auth/login/2fa");
  }
}
