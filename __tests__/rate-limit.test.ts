import { describe, expect, it } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit (memory)", () => {
  it("allows requests under limit", async () => {
    const key = `test-allow-${Date.now()}`;
    const first = await checkRateLimit(key, 3, 60_000);
    const second = await checkRateLimit(key, 3, 60_000);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });

  it("blocks when limit exceeded", async () => {
    const key = `test-block-${Date.now()}`;
    await checkRateLimit(key, 2, 60_000);
    await checkRateLimit(key, 2, 60_000);
    const third = await checkRateLimit(key, 2, 60_000);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSec).toBeGreaterThan(0);
  });
});
