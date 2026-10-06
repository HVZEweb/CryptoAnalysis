import { describe, expect, it } from "vitest";
import { pickSourceIp } from "@/lib/outbound-proxy";
import { recordTelegram, telegramFailing, telegramHealth } from "@/lib/telegram";

describe("VPN source address", () => {
  it("keeps the configured address while the server has it", () => {
    expect(pickSourceIp("10.77.77.1", ["83.222.16.56", "10.77.77.1"])).toBe("10.77.77.1");
  });

  it("follows the VPN when it hands out another address in the same network", () => {
    expect(pickSourceIp("10.77.77.1", ["83.222.16.56", "10.77.77.2"])).toBe("10.77.77.2");
  });

  it("binds nothing when the tunnel address is gone, so requests go direct instead of failing", () => {
    expect(pickSourceIp("10.77.77.1", ["83.222.16.56"])).toBeNull();
  });
});

describe("Telegram delivery health", () => {
  it("is failing after an error until the next success", () => {
    const t0 = Date.now();
    recordTelegram(true, undefined, t0);
    expect(telegramFailing()).toBe(false);
    recordTelegram(false, new Error("connect EADDRNOTAVAIL bot123:SECRET"), t0 + 1000);
    expect(telegramFailing()).toBe(true);
    expect(telegramHealth().lastError).not.toContain("SECRET");
    recordTelegram(true, undefined, t0 + 2000);
    expect(telegramFailing()).toBe(false);
  });
});
