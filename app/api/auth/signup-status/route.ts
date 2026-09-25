import { NextResponse } from "next/server";
import { countUsers, isSignupOpen, isSitePrivate } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const open = await isSignupOpen().catch(() => false);
  const firstAccount = (await countUsers().catch(() => 1)) === 0;
  return NextResponse.json({ open, private: isSitePrivate(), firstAccount });
}
