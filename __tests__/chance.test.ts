import { describe, expect, it } from "vitest";
import { chanceMessage, chancePlan, holdMinutes, intervalMinutes, newsPlan } from "@/services/signals/chance";

describe("chance plans", () => {
  it("puts target and stop at the same distance, one ATR scaled by √bars", () => {
    const p = chancePlan("SHORT", 100, 2, 4, 0, 60)!;
    expect(p).toMatchObject({ side: "SHORT", entry: 100, tp: 96, sl: 104, closeBy: 4 * 3_600_000 });
    expect(chancePlan("LONG", 100, 0, 4, 0, 60)).toBeNull();
  });

  it("sets a news target at the expected move and caps absurd moves", () => {
    expect(newsPlan("LONG", 200, 1.5, 45, 0)).toMatchObject({ tp: 203, sl: 197, closeBy: 45 * 60_000 });
    expect(newsPlan("LONG", 100, 40, 60, 0)!.tp).toBeCloseTo(103); // no ±10% targets for a 45-minute hold
  });

  it("reads news hold times and Binance intervals", () => {
    expect(holdMinutes("5-15 min")).toBe(15);
    expect(holdMinutes("45-90 min")).toBe(90);
    expect(holdMinutes("1-4 hours")).toBe(240);
    expect(intervalMinutes("15m")).toBe(15);
    expect(intervalMinutes("4h")).toBe(240);
    expect(intervalMinutes("1d")).toBe(1440);
  });

  it("writes step-by-step instructions and says the profit is unproven", () => {
    const text = chanceMessage({ symbol: "ETHUSDT", title: "1h", pUp: 0.58, confidentAccuracy: 0.548, plan: chancePlan("LONG", 100, 1, 1, 0, 60)! });
    expect(text).toContain("Открыть LONG рыночным ордером");
    expect(text).toContain("угадано в 54.8%");
    expect(text).toContain("позиция ≈ 1.0 депозита");
    expect(text).toContain("не подтверждена");
  });
});
