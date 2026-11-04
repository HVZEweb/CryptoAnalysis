import { NextRequest, NextResponse } from "next/server";
import { verifyEmailWithToken } from "@/lib/auth";
import { limitByIp } from "@/lib/auth-http";
import { clientMeta, publicOrigin } from "@/lib/request-context";

/** The link from the confirmation email: confirms the address and opens the account page. */
export async function GET(request: NextRequest) {
  const limited = await limitByIp(request, "auth-verify", 20, 15 * 60_000);
  if (limited) return limited;
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const user = token ? await verifyEmailWithToken(token, clientMeta(request)).catch(() => null) : null;
  return NextResponse.redirect(`${publicOrigin(request)}/account?verified=${user ? "1" : "0"}`, 303);
}
