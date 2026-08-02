import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(() => "127.0.0.1"),
  resolveIdentity: vi.fn(),
  checkQuotaAllowed: vi.fn(),
  reserveQuota: vi.fn(),
  refundQuota: vi.fn(),
  getDeviceId: vi.fn(() => "device-1"),
  getSessionToken: vi.fn(() => null),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  getClientIp: mocks.getClientIp,
}));

vi.mock("@/lib/quota", () => ({
  resolveIdentity: mocks.resolveIdentity,
  checkQuotaAllowed: mocks.checkQuotaAllowed,
  reserveQuota: mocks.reserveQuota,
  refundQuota: mocks.refundQuota,
}));

vi.mock("@/lib/request-context", () => ({
  getDeviceId: mocks.getDeviceId,
  getSessionToken: mocks.getSessionToken,
}));

import { enforcePredictionAccess, releaseReservedQuota } from "@/lib/predict-guard";

function mockRequest(): NextRequest {
  return { headers: new Headers() } as NextRequest;
}

describe("enforcePredictionAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveIdentity.mockResolvedValue({ tier: "anon", userId: null, deviceId: "device-1" });
    mocks.checkQuotaAllowed.mockResolvedValue({ allowed: true });
    mocks.reserveQuota.mockResolvedValue(true);
  });

  it("returns rate limit when burst exceeded", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSec: 42 });
    const result = await enforcePredictionAccess(mockRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("RATE_LIMIT");
      expect(result.status).toBe(429);
    }
  });

  it("returns quota exceeded when not allowed", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
    mocks.checkQuotaAllowed.mockResolvedValue({ allowed: false, message: "Лимит" });
    const result = await enforcePredictionAccess(mockRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("QUOTA_EXCEEDED");
  });

  it("reserves quota and succeeds", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
    const result = await enforcePredictionAccess(mockRequest());
    expect(result.ok).toBe(true);
    expect(mocks.reserveQuota).toHaveBeenCalledOnce();
  });

  it("refunds reserved quota on release", async () => {
    const identity = { tier: "anon" as const, userId: null, deviceId: "device-1" };
    await releaseReservedQuota(identity);
    expect(mocks.refundQuota).toHaveBeenCalledWith(identity);
  });
});
