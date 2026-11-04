import { NextRequest, NextResponse } from "next/server";
import { findUserById } from "@/lib/auth";
import { publicUser } from "@/lib/auth-http";
import { getQuotaStatus, resolveIdentity } from "@/lib/quota";
import { cleanupAuth } from "@/lib/sessions";
import { getDeviceId, getSessionToken } from "@/lib/request-context";

export async function GET(request: NextRequest) {
  try {
    await cleanupAuth().catch((e) => console.error("[auth cleanup]", (e as Error).message));
    const identity = await resolveIdentity(getDeviceId(request), getSessionToken(request));
    const status = await getQuotaStatus(identity);

    const user = identity.userId ? await findUserById(identity.userId) : null;
    return NextResponse.json({ user: user ? publicUser(user) : null, quota: status });
  } catch (error) {
    console.error("[auth/me]", error);
    return NextResponse.json(
      { error: "Сервис авторизации временно недоступен", user: null, quota: null },
      { status: 503 }
    );
  }
}
