import { describe, expect, it } from "vitest";
import type { Candle } from "@/types";
import { alignCloses, evaluateCrossSection, runXsSetup, XS_FEES, xsMetrics } from "@/services/cross-section/research";

const DAY = 86_400_000;

function daily(closes: number[], firstDay = 0): Candle[] {
  return closes.map((close, i) => ({
    openTime: (firstDay + i) * DAY,
    closeTime: (firstDay + i + 1) * DAY - 1,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  })) as Candle[];
}

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
}

/** 20 coins over 700 days; `persistence` > 0 makes each coin's recent winners keep winning. */
function market(persistence: number, seed: number): Map<string, Candle[]> {
  const rnd = rng(seed);
  const out = new Map<string, Candle[]>();
  for (let c = 0; c < 20; c++) {
    let price = 100;
    let drift = 0;
    const closes: number[] = [];
    for (let d = 0; d < 700; d++) {
      if (d % 30 === 0) drift = (rnd() - 0.5) * 0.02 * persistence;
      price *= 1 + drift + (rnd() - 0.5) * 0.04;
      closes.push(price);
    }
    out.set(`C${c}USDT`, daily(closes));
  }
  return out;
}

describe("alignCloses", () => {
  it("puts coins on one calendar with gaps before listing", () => {
    const { days, closes } = alignCloses(new Map([["A", daily([1, 2, 3])], ["B", daily([5], 2)]]));
    expect(days).toHaveLength(3);
    expect(closes[1].slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(closes[1][2]).toBe(5);
  });
});

describe("runXsSetup", () => {
  it("holds a market-neutral book and pays fees on turnover", () => {
    const coins = Array.from({ length: 10 }, (_, i) => [100, 100 + i, 100 + 2 * i]);
    const periods = runXsSetup(coins, { mode: "momentum", lookback: 1, hold: 1 });
    expect(periods).toHaveLength(1);
    // Longs gained more than shorts; the first rebalance trades the whole book.
    expect(periods[0].gross).toBeGreaterThan(0);
    expect(periods[0].turnover).toBeCloseTo(1);
    expect(xsMetrics(periods, 1).avgNetBp).toBeCloseTo((periods[0].gross - XS_FEES.maker) * 1e4);
  });

  it("exits a coin delisted during the hold at its last close", () => {
    const coins = Array.from({ length: 10 }, (_, i) => [100, 100 + i, 100 + 2 * i, 100 + 3 * i]);
    coins[9] = [100, 109, 118, NaN];
    const [p] = runXsSetup(coins, { mode: "momentum", lookback: 1, hold: 2 });
    expect(p.gross).toBeGreaterThan(0);
  });
});

describe("evaluateCrossSection", () => {
  it("confirms momentum when winners really keep winning", () => {
    const report = evaluateCrossSection(market(1, 3));
    expect(report.profitable).toBe(true);
    expect(report.best!.setup.mode).toBe("momentum");
    expect(report.best!.holdout.avgNetBp).toBeGreaterThan(0);
  });

  it("finds nothing in a market without persistence", () => {
    const report = evaluateCrossSection(market(0, 11));
    expect(report.profitable).toBe(false);
    expect(report.setupsTested).toBe(48);
  });

  it("refuses to judge too few coins", () => {
    const few = new Map([...market(1, 5)].slice(0, 5));
    expect(evaluateCrossSection(few).reason).toMatch(/мало данных/);
  });
});
