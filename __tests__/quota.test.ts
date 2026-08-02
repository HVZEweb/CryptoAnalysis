import { describe, expect, it } from "vitest";
import { getQuotaLimit } from "@/lib/quota-config";

describe("quota limits", () => {
  it("anon gets 1 prediction", () => {
    expect(getQuotaLimit("anon")).toBe(1);
  });

  it("registered gets 3 total", () => {
    expect(getQuotaLimit("registered")).toBe(3);
  });

  it("paid gets unlimited", () => {
    expect(getQuotaLimit("paid")).toBeGreaterThan(1000);
  });
});
