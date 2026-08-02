import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredSessions, findUserById } from "@/lib/auth";
import { getQuotaStatus, resolveIdentity } from "@/lib/quota";
import { getDeviceId, getSessionToken } from "@/lib/request-context";

export async function GET(request: NextRequest) {
  try {
    await cleanupExpiredSessions();
    const identity = await resolveIdentity(getDeviceId(request), getSessionToken(request));
    const status = await getQuotaStatus(identity);

    if (!identity.userId) {
      return NextResponse.json({ user: null, quota: status });
    }

    const user = await findUserById(identity.userId);
    if (!user) {
      return NextResponse.json({ user: null, quota: status });
    }

    return NextResponse.json({
      user: { email: user.email, tier: user.tier, predictionsUsed: user.predictionsUsed },
      quota: status,
    });
  } catch (error) {
    console.error("[auth/me]", error);
    return NextResponse.json(
      { error: "Сервис авторизации временно недоступен", user: null, quota: null },
      { status: 503 }
    );
  }
}
