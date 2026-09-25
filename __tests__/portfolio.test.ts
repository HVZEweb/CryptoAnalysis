import { describe, expect, it } from "vitest";
import type { Candle } from "@/types";
import {
  buildUniverse,
  lowVolStrategy,
  periodStats,
  REBALANCE_COST,
  runStrategy,
  trendStrategy,
  type Strategy,
} from "@/services/research/portfolio";

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);

function daily(closes: number[], startDay = 0): Candle[] {
  return closes.map((c, i) => ({ openTime: T0 + (startDay + i) * DAY, closeTime: T0 + (startDay + i + 1) * DAY - 1, open: c, high: c, low: c, close: c, volume: 1 }) as Candle);
}

describe("runStrategy", () => {
  it("earns the next day's move on the weight, minus rebalancing costs and funding", () => {
    const u = buildUniverse([{ symbol: "A", candles: daily([100, 110, 121]), funding: [{ time: T0 + 1 * DAY, rate: 0.001 }] }]);
    const always: Strategy = () => [1];
    const run = runStrategy(u, always);
    // day 1: +10%, entry cost, funding 0.1% paid by the long; day 2: +10%
    expect(run.returns[1]).toBeCloseTo(0.1 - REBALANCE_COST - 0.001);
    expect(run.returns[2]).toBeCloseTo(0.1);
    expect(run.turnover).toBeCloseTo(1);
    expect(run.funding).toBeCloseTo(-0.001);
  });

  it("does not hold a coin before it is listed", () => {
    const u = buildUniverse([
      { symbol: "A", candles: daily([100, 100, 100, 100]), funding: [] },
      { symbol: "B", candles: daily([50, 60], 2), funding: [] },
    ]);
    const run = runStrategy(u, () => [0, 1]);
    expect(run.start).toBe(3);
  });
});

describe("trendStrategy", () => {
  it("goes long after a breakout and scales down volatile coins", () => {
    const up = Array.from({ length: 420 }, (_, i) => 100 * Math.exp(0.002 * i + 0.01 * Math.sin(i)));
    const u = buildUniverse([{ symbol: "A", candles: daily(up), funding: [] }]);
    const strat = trendStrategy(false);
    let w: number[] = [0];
    for (let d = 0; d < up.length; d++) w = strat(u, d, w);
    expect(w[0]).toBeGreaterThan(0);
    expect(w[0]).toBeLessThanOrEqual(1);
  });

  it("stays flat in a long-only run and shorts a downtrend when allowed", () => {
    const down = Array.from({ length: 420 }, (_, i) => 100 * Math.exp(-0.002 * i + 0.01 * Math.sin(i)));
    const u = buildUniverse([{ symbol: "A", candles: daily(down), funding: [] }]);
    const run = (s: Strategy) => {
      let w: number[] = [0];
      for (let d = 0; d < down.length; d++) w = s(u, d, w);
      return w[0];
    };
    expect(run(trendStrategy(false))).toBe(0);
    expect(run(trendStrategy(true))).toBeLessThan(0);
  });
});

describe("lowVolStrategy", () => {
  it("is long the calm third and short the volatile third, market-neutral", () => {
    const n = 100;
    const coins = Array.from({ length: 6 }, (_, k) => ({
      symbol: `C${k}`,
      candles: daily(Array.from({ length: n }, (_, i) => 100 * (1 + (k + 1) * 0.005 * Math.sin(i)))),
      funding: [],
    }));
    const u = buildUniverse(coins);
    const d = u.days.findIndex((t) => new Date(t).getUTCDate() === 1 && u.days.indexOf(t) >= 65);
    const w = lowVolStrategy(60)(u, d, new Array(6).fill(0));
    expect(w[0]).toBeGreaterThan(0);
    expect(w[5]).toBeLessThan(0);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(0);
    expect(w.reduce((a, b) => a + Math.abs(b), 0)).toBeCloseTo(1);
  });
});

describe("periodStats", () => {
  it("annualises and measures drawdown", () => {
    const s = periodStats([0.01, -0.02, 0.01, 0.01]);
    expect(s.days).toBe(4);
    expect(s.maxDrawdownPct).toBeCloseTo(2, 5);
    expect(s.tStat).toBeGreaterThan(0);
  });
});

describe("point-in-time universe", () => {
  it("admits only coins that were liquid and listed long enough on that day", async () => {
    const { liquidTop } = await import("@/services/research/portfolio");
    const mk = (symbol: string, vol: number, startDay = 0, len = 100) => ({
      symbol,
      candles: daily(Array.from({ length: len }, () => 100), startDay).map((c) => ({ ...c, quoteVolume: vol })),
      funding: [],
    });
    const u = buildUniverse([mk("BIG", 1e9), mk("MID", 1e8), mk("SMALL", 1e6), mk("NEW", 1e10, 80, 20)]);
    const top2 = liquidTop(2);
    const d = 95;
    expect(top2(u, 0, d)).toBe(true);
    expect(top2(u, 1, d)).toBe(true);
    expect(top2(u, 2, d)).toBe(false);
    expect(top2(u, 3, d)).toBe(false); // listed 15 days ago: not eligible yet despite its volume
  });

  it("trades one leg with full gross when asked", async () => {
    const { rankStrategy } = await import("@/services/research/portfolio");
    const coins = Array.from({ length: 6 }, (_, k) => ({ symbol: `C${k}`, candles: daily([100, 100]), funding: [] }));
    const u = buildUniverse(coins);
    const score = (_: unknown, s: number) => s;
    const long = rankStrategy(score, () => true, { leg: "long" })(u, 0, new Array(6).fill(0));
    const short = rankStrategy(score, () => true, { leg: "short" })(u, 0, new Array(6).fill(0));
    expect(long).toEqual([0.5, 0.5, 0, 0, 0, 0]);
    expect(short).toEqual([0, 0, 0, 0, -0.5, -0.5]);
  });
});
