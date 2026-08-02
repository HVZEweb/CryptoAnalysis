import type { NextRequest } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { checkQuotaAllowed, refundQuota, reserveQuota, resolveIdentity } from "@/lib/quota";
import { getDeviceId, getSessionToken } from "@/lib/request-context";

export async function enforcePredictionAccess(request: NextRequest): Promise<
  | { ok: true; identity: Awaited<ReturnType<typeof resolveIdentity>> }
  | {
      ok: false;
      status: number;
      code: "RATE_LIMIT" | "QUOTA_EXCEEDED";
      message: string;
      retryAfterSec?: number;
    }
> {
  if (process.env.SKIP_PREDICTION_QUOTA === "true") {
    const identity = await resolveIdentity(getDeviceId(request), getSessionToken(request));
    return { ok: true, identity };
  }

  const ip = getClientIp(request);
  const burst = await checkRateLimit(`predict-burst:${ip}`, 3, 60_000);
  if (!burst.allowed) {
    return {
      ok: false,
      status: 429,
      code: "RATE_LIMIT",
      message: `Слишком частые запросы. Повторите через ${burst.retryAfterSec} сек.`,
      retryAfterSec: burst.retryAfterSec,
    };
  }

  const identity = await resolveIdentity(getDeviceId(request), getSessionToken(request));
  const quota = await checkQuotaAllowed(identity);

  if (!quota.allowed) {
    return {
      ok: false,
      status: 402,
      code: "QUOTA_EXCEEDED",
      message: quota.message ?? "Лимит прогнозов исчерпан",
    };
  }

  const reserved = await reserveQuota(identity);
  if (!reserved) {
    return {
      ok: false,
      status: 402,
      code: "QUOTA_EXCEEDED",
      message: "Лимит прогнозов исчерпан",
    };
  }

  return { ok: true, identity };
}

export async function releaseReservedQuota(identity: Awaited<ReturnType<typeof resolveIdentity>>): Promise<void> {
  await refundQuota(identity);
}
