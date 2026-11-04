import { NextResponse } from "next/server";
import { countUsers, isSignupOpen, isSitePrivate } from "@/lib/auth";
import { mailConfigured } from "@/lib/mailer";

export const dynamic = "force-dynamic";

export async function GET() {
  const open = await isSignupOpen().catch(() => false);
  const firstAccount = (await countUsers().catch(() => 1)) === 0;
  // mail: whether "forgot password" can send a link, or the person has to ask the admin.
  return NextResponse.json({ open, private: isSitePrivate(), firstAccount, mail: mailConfigured() });
}
