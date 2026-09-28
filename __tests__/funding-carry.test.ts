import { describe, expect, it } from "vitest";
import { CARRY_MIN_DAYS, DAY, carryStats, dayResult, eligibleAt, rebalanceCost, targetWeights, universeAt, type CoinDays } from "@/services/funding-carry/rule";
import { REBALANCE_COST } from "@/services/research/portfolio";

const MONDAY = Date.UTC(2026, 8, 28);

/** A coin trading every day of the window with a flat price, `volume` a day and `funding` settled each day. */
function coin(symbol: string, volume: number, funding: number, listedDaysAgo = CARRY_MIN_DAYS): CoinDays {
  const c: CoinDays = { symbol, close: new Map(), volume: new Map(), funding: new Map() };
  for (let i = 0; i <= listedDaysAgo; i++) {
    const d = MONDAY - i * DAY;
    c.close.set(d, 1);
    c.volume.set(d, volume);
    c.funding.set(d, funding);
  }
  return c;
}

describe("funding forward test rule", () => {
  const coins = Array.from({ length: 9 }, (_, i) => coin(`C${i}USDT`, 1000 - i, i / 10_000));

  it("longs the lowest funding third and shorts the highest, half the capital per side", () => {
    const w = targetWeights(universeAt(MONDAY, coins), 100);
    expect(Object.keys(w).filter((s) => w[s] > 0).sort()).toEqual(["C0USDT", "C1USDT", "C2USDT"]);
    expect(Object.keys(w).filter((s) => w[s] < 0).sort()).toEqual(["C6USDT", "C7USDT", "C8USDT"]);
    expect(Object.values(w).reduce((a, x) => a + Math.abs(x), 0)).toBeCloseTo(1);
  });

  it("keeps only the most liquid coins listed long enough, as the backtest does", () => {
    const young = coin("NEWUSDT", 1e9, 0, 10);
    const u = universeAt(MONDAY, [...coins, young]);
    expect(eligibleAt(u, 5)).toEqual(["C0USDT", "C1USDT", "C2USDT", "C3USDT", "C4USDT"]);
  });

  it("pays funding on longs, earns it on shorts, and skips coins without a bar", () => {
    const r = dayResult({ A: 0.5, B: -0.5, C: 0.5 }, { A: { prevClose: 100, close: 110, funding: 0.001 }, B: { prevClose: 100, close: 90, funding: 0.001 }, C: { funding: 0 } });
    expect(r.price).toBeCloseTo(0.1);
    expect(r.funding).toBeCloseTo(0);
  });

  it("charges turnover at the backtest's cost", () => {
    expect(rebalanceCost({ A: 0.5 }, { A: -0.5, B: 0.5 })).toBeCloseTo(1.5 * REBALANCE_COST);
  });

  it("compounds returns and measures the drawdown", () => {
    const s = carryStats([0.1, -0.5, 0.2]);
    expect(s.totalPct).toBeCloseTo((1.1 * 0.5 * 1.2 - 1) * 100);
    expect(s.maxDrawdownPct).toBeCloseTo(50);
  });
});
