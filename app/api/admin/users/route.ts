import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminSecret } from "@/lib/admin-auth";
import { listUsers, setUserTier } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!verifyAdminSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const users = await listUsers(200);
  return NextResponse.json({ users });
}

const upgradeSchema = z.object({
  email: z.string().email(),
  tier: z.enum(["registered", "paid"]),
});

export async function POST(request: NextRequest) {
  if (!verifyAdminSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = upgradeSchema.parse(await request.json());
  const ok = await setUserTier(body.email, body.tier);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "User not found" }, { status: 404 });
}
