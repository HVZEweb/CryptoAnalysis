export const QUOTA_LIMITS = {
  anon: 1,
  registered: 3,
  paid: 999_999,
} as const;

export type UserTier = keyof typeof QUOTA_LIMITS;

export function getQuotaLimit(tier: UserTier): number {
  return QUOTA_LIMITS[tier];
}
