import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";
import { disableTwoFactor, enableTwoFactor, regenerateRecoveryCodes, startTwoFactorSetup } from "@/lib/auth";
import { getRequestUser } from "@/lib/admin-auth";
import { authFailure, jsonBody, limitByIp } from "@/lib/auth-http";
import { clientMeta } from "@/lib/request-context";
import { otpauthUrl } from "@/lib/totp";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setup") }),
  z.object({ action: z.literal("enable"), code: z.string().trim().min(6).max(16) }),
  z.object({ action: z.literal("disable"), password: z.string().min(1).max(1024), code: z.string().trim().min(6).max(32) }),
  z.object({ action: z.literal("recovery-codes"), password: z.string().min(1).max(1024), code: z.string().trim().min(6).max(32) }),
]);

/** Two-step sign-in: setup (QR code) → enable (first code, recovery codes) → disable / new recovery codes. */
export async function POST(request: Request) {
  const me = await getRequestUser(request);
  if (!me) return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
  const limited = await limitByIp(request, "account-2fa", 20, 15 * 60_000);
  if (limited) return limited;
  const parsed = schema.safeParse(await jsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Введите код из приложения" }, { status: 400 });

  try {
    const body = parsed.data;
    const meta = clientMeta(request);
    if (body.action === "setup") {
      const secret = await startTwoFactorSetup(me.user.id);
      const url = otpauthUrl(secret, me.user.email);
      const qr = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      return NextResponse.json({ secret, qr });
    }
    if (body.action === "enable") return NextResponse.json({ recoveryCodes: await enableTwoFactor(me.user.id, body.code, meta) });
    if (body.action === "disable") {
      await disableTwoFactor(me.user.id, body.password, body.code, meta);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ recoveryCodes: await regenerateRecoveryCodes(me.user.id, body.password, body.code) });
  } catch (error) {
    return authFailure(error, "account/2fa");
  }
}
