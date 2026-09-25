import { describe, expect, it } from "vitest";
import type { Candle } from "@/types";
import {
  atr14,
  evaluateStrategies,
  metricsOf,
  tradeCost,
  simulateBracket,
  type LabPoint,
  type TradeSetup,
} from "@/services/strategy-lab/lab";
import { strategySignal } from "@/services/strategy-lab/signal";
import type { PricePrediction } from "@/services/predictor";

const HOUR = 3_600_000;

function candle(i: number, open: number, high: number, low: number, close: number): Candle {
  return { openTime: i * HOUR, closeTime: (i + 1) * HOUR - 1, open, high, low, close, volume: 1 } as Candle;
}

/** Seeded random walk so the tests are deterministic. */
function randomWalk(n: number, seed: number): Candle[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const close = price * (1 + (rnd() - 0.5) * 0.02);
    const high = Math.max(price, close) * (1 + rnd() * 0.004);
    const low = Math.min(price, close) * (1 - rnd() * 0.004);
    out.push(candle(i, price, high, low, close));
    price = close;
  }
  return out;
}

describe("simulateBracket", () => {
  const bars = [candle(0, 100, 100, 100, 100), candle(1, 100, 103, 97, 100), candle(2, 100, 101, 99, 100)];

  it("counts a candle that touches both levels as a stop", () => {
    expect(simulateBracket(bars, 0, 1, 2, 2, 2)).toEqual({ ret: -0.02, exitIndex: 1, exit: "sl" });
  });

  it("takes profit when only the target is touched", () => {
    expect(simulateBracket(bars, 0, -1, 2, 5, 2)).toEqual({ ret: 0.02, exitIndex: 1, exit: "tp" });
  });

  it("closes at the horizon when neither level is hit", () => {
    const r = simulateBracket(bars, 0, 1, 10, 10, 2);
    expect(r.exitIndex).toBe(2);
    expect(r.ret).toBe(0);
    expect(r.exit).toBe("time");
  });
});

describe("metricsOf", () => {
  it("charges a market entry, a limit take-profit and a market stop, with slippage", () => {
    expect(tradeCost("tp")).toBeCloseTo(0.001); // 0.05% + 0.03% in, 0.02% out
    expect(tradeCost("sl")).toBeCloseTo(0.0016); // market both ways
    expect(tradeCost("time")).toBeCloseTo(0.0016);
    expect(tradeCost("tp", true)).toBeCloseTo(0.0016);
    const m = metricsOf(
      [
        { time: 0, gross: 0.01, exit: "tp" },
        { time: 1, gross: -0.005, exit: "sl" },
      ],
      7 * 86_400_000
    );
    expect(m.avgNetBp).toBeCloseTo(((0.01 - 0.001 + -0.005 - 0.0016) / 2) * 1e4);
    expect(m.avgNetBpTaker).toBeCloseTo(((0.01 - 0.0016 + -0.005 - 0.0016) / 2) * 1e4);
    expect(m.tradesPerWeek).toBe(2);
  });
});

describe("atr14", () => {
  it("is undefined for the first 14 bars", () => {
    const a = atr14(randomWalk(20, 1));
    expect(a.slice(0, 14).every(Number.isNaN)).toBe(true);
    expect(a[14]).toBeGreaterThan(0);
  });
});

function pointsFrom(candles: Candle[], pUp: (i: number) => number): LabPoint[] {
  const atr = atr14(candles);
  const points: LabPoint[] = [];
  for (let i = 20; i < candles.length - 1; i++) {
    points.push({ symbol: "TEST", time: candles[i].openTime, index: i, pUp: pUp(i), atr: atr[i] });
  }
  return points;
}

describe("evaluateStrategies", () => {
  const candles = randomWalk(4000, 42);
  const bySymbol = new Map([["TEST", candles]]);

  it("finds nothing profitable in noise", () => {
    let s = 7;
    const coin = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const report = evaluateStrategies(pointsFrom(candles, () => 0.4 + coin() * 0.2), bySymbol, 1);
    expect(report.profitable).toBe(false);
    expect(report.setupsTested).toBe(144);
  });

  it("confirms a signal that really knows the next bar", () => {
    const peek = (i: number) => (candles[i + 1].close > candles[i].close ? 0.6 : 0.4);
    const report = evaluateStrategies(pointsFrom(candles, peek), bySymbol, 1);
    expect(report.profitable).toBe(true);
    expect(report.best!.holdout.avgNetBp).toBeGreaterThan(0);
    expect(report.holdoutPeriod.from >= report.selectionPeriod.to).toBe(true);
  });

  it("refuses to judge a short history", () => {
    expect(evaluateStrategies(pointsFrom(candles.slice(0, 200), () => 0.6), bySymbol, 1).reason).toBe(
      "мало данных для проверки"
    );
  });
});

describe("strategySignal", () => {
  const setup: TradeSetup = { slAtr: 1.5, rr: 2, horizon: 4, minEdge: 0.04 };
  const metrics = { trades: 60, winRate: 0.45, avgNetBp: 5, avgNetBpTaker: -1, tStat: 2, totalPct: 3, maxDrawdownPct: 1, tradesPerWeek: 2 };
  const run = (pUp: number, profitable: boolean) =>
    ({
      probabilityUp: pUp,
      atr: 10,
      model: {
        interval: "1h",
        strategy: {
          profitable,
          reason: profitable ? "ok" : "даже лучшая из 144 настроек убыточна",
          best: { setup, selection: metrics, holdout: metrics },
        },
      },
    }) as unknown as PricePrediction;

  it("is untested without a lab report", () => {
    expect(strategySignal(null, 100).status).toBe("untested");
  });

  it("passes on the lab's reason when nothing pays", () => {
    expect(strategySignal(run(0.7, false), 100)).toMatchObject({ status: "no_setup", reason: "даже лучшая из 144 настроек убыточна" });
  });

  it("waits for a signal as strong as the validated threshold", () => {
    expect(strategySignal(run(0.52, true), 100).status).toBe("weak_signal");
  });

  it("sizes stop and target from the model's ATR", () => {
    expect(strategySignal(run(0.45, true), 100)).toMatchObject({ status: "trade", side: "SHORT", levels: { sl: 115, tp: 70 } });
  });
});
