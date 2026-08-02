import { NextRequest, NextResponse } from "next/server";
import { findUserById } from "@/lib/auth";
import { getQuotaStatus, resolveIdentity } from "@/lib/quota";
import { getDeviceId, getSessionToken } from "@/lib/request-context";

export async function GET(request: NextRequest) {
  const identity = await resolveIdentity(getDeviceId(request), getSessionToken(request));
  const status = await getQuotaStatus(identity);
  const user = identity.userId ? await findUserById(identity.userId) : null;

  return NextResponse.json({
    ...status,
    email: user?.email,
  });
}
