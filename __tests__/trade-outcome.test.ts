import { describe, expect, it } from "vitest";
import { buildCalibration, evaluateTradeOutcome } from "@/lib/monitoring/trade-outcome";
import type { Candle } from "@/types";

const bar = (high: number, low: number, close: number): Candle => ({
  openTime: 0,
  open: close,
  high,
  low,
  close,
  volume: 1,
  closeTime: 0,
  quoteVolume: 1,
  trades: 1,
});

describe("evaluateTradeOutcome", () => {
  // The reported BTC 15m LONG: entry 84148.6, TP 84385, SL 83991; high 84470, closed 84382.
  it("counts the reported BTC case as TP first and a direction hit", () => {
    const out = evaluateTradeOutcome(
      { direction: "LONG", entry: 84148.6, tp: 84385, sl: 83991, feeRoundTrip: 0.001 },
      [bar(84250, 84100, 84230), bar(84470, 84200, 84400), bar(84420, 84350, 84382)]
    )!;
    expect(out.firstHit).toBe("tp");
    expect(out.directionHit).toBe(true);
    // +236.4 gross (0.281%) minus 0.1% fees
    expect(out.tradeReturnPct).toBeCloseTo(((84385 - 84148.6) / 84148.6 - 0.001) * 100);
  });

  it("treats a candle touching both levels as SL (conservative)", () => {
    const out = evaluateTradeOutcome(
      { direction: "SHORT", entry: 100, tp: 98, sl: 101, feeRoundTrip: 0 },
      [bar(101.5, 97.5, 99)]
    )!;
    expect(out.firstHit).toBe("sl");
    expect(out.directionHit).toBe(true);
    expect(out.tradeReturnPct).toBeCloseTo(-1);
  });

  it("closes at the horizon when neither level is hit", () => {
    const out = evaluateTradeOutcome(
      { direction: "LONG", entry: 100, tp: 110, sl: 90, feeRoundTrip: 0.001 },
      [bar(101, 99, 99.5)]
    )!;
    expect(out.firstHit).toBeNull();
    expect(out.directionHit).toBe(false);
    expect(out.tradeReturnPct).toBeCloseTo(-0.6);
  });
});

describe("buildCalibration", () => {
  it("compares stated probability with the realised hit rate per bucket", () => {
    const calls = [
      ...Array.from({ length: 10 }, (_, i) => ({ probability: 54, directionHit: i < 6 })),
      ...Array.from({ length: 4 }, (_, i) => ({ probability: 64, directionHit: i < 2 })),
    ];
    const buckets = buildCalibration(calls);
    const mid = buckets.find((b) => b.label === "53–56%")!;
    expect(mid.count).toBe(10);
    expect(mid.stated).toBe(54);
    expect(mid.actual).toBe(60);
    expect(buckets.find((b) => b.label === "60%+")!.actual).toBe(50);
  });
});
