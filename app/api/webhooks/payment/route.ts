import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setUserTier } from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  tier: z.enum(["registered", "paid"]).default("paid"),
  secret: z.string().optional(),
});

function isAuthorized(request: NextRequest, bodySecret?: string): boolean {
  const envSecret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!envSecret) return false;
  const header = request.headers.get("x-webhook-secret");
  return header === envSecret || bodySecret === envSecret;
}

export async function POST(request: NextRequest) {
  const body = schema.parse(await request.json());
  if (!isAuthorized(request, body.secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ok = await setUserTier(body.email, body.tier);
  return ok
    ? NextResponse.json({ ok: true, email: body.email, tier: body.tier })
    : NextResponse.json({ error: "User not found" }, { status: 404 });
}
