import { findUserById, getEffectiveUsage, getUserIdBySession, reserveQuotaAtomic, refundQuotaAtomic } from "@/lib/auth";
import { getQuotaLimit, type UserTier } from "@/lib/quota-config";

export interface QuotaStatus {
  tier: UserTier;
  used: number;
  limit: number;
  remaining: number;
  isLoggedIn: boolean;
  email?: string;
  requiresAuth: boolean;
  requiresPayment: boolean;
}

export interface RequestIdentity {
  deviceId: string;
  sessionToken?: string;
  userId?: string;
}

export async function resolveIdentity(
  deviceId: string | undefined,
  sessionToken: string | undefined
): Promise<RequestIdentity & { tier: UserTier; user?: Awaited<ReturnType<typeof findUserById>> }> {
  const device = deviceId ?? "unknown";
  const userId = await getUserIdBySession(sessionToken);
  const user = userId ? await findUserById(userId) : null;

  let tier: UserTier = "anon";
  if (user?.tier === "paid" || user?.role === "admin") tier = "paid";
  else if (user) tier = "registered";

  return { deviceId: device, sessionToken, userId: userId ?? undefined, tier, user: user ?? undefined };
}

export async function getQuotaStatus(identity: Awaited<ReturnType<typeof resolveIdentity>>): Promise<QuotaStatus> {
  const { tier, user, deviceId, userId } = identity;
  const limit = getQuotaLimit(tier);
  const used = await getEffectiveUsage(deviceId, user);
  const remaining = Math.max(0, limit - used);
  const isLoggedIn = Boolean(userId && user);

  return {
    tier,
    used,
    limit,
    remaining,
    isLoggedIn,
    email: user?.email,
    requiresAuth: !isLoggedIn && remaining <= 0,
    requiresPayment: isLoggedIn && tier === "registered" && remaining <= 0,
  };
}

export async function checkQuotaAllowed(identity: Awaited<ReturnType<typeof resolveIdentity>>): Promise<{
  allowed: boolean;
  status: QuotaStatus;
  message?: string;
}> {
  const status = await getQuotaStatus(identity);

  if (status.remaining > 0) {
    return { allowed: true, status };
  }

  if (status.requiresAuth) {
    return {
      allowed: false,
      status,
      message: "Бесплатный прогноз использован. Зарегистрируйтесь, чтобы получить ещё 2.",
    };
  }

  if (status.requiresPayment) {
    return {
      allowed: false,
      status,
      message: "Лимит бесплатных прогнозов исчерпан (3 из 3). Оформите подписку для продолжения.",
    };
  }

  return {
    allowed: false,
    status,
    message: "Лимит прогнозов исчерпан.",
  };
}

export async function reserveQuota(identity: Awaited<ReturnType<typeof resolveIdentity>>): Promise<boolean> {
  return reserveQuotaAtomic(identity.deviceId, identity.userId, identity.tier);
}

export async function refundQuota(identity: Awaited<ReturnType<typeof resolveIdentity>>): Promise<void> {
  return refundQuotaAtomic(identity.deviceId, identity.userId);
}
