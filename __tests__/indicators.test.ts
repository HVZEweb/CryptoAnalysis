import { describe, expect, it } from "vitest";
import { calculateIndicators, analyzeMarketStructure, calculateLevels } from "@/lib/indicators";
import type { Candle } from "@/types";

function makeCandles(count: number, startPrice = 100): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const price = startPrice + Math.sin(i / 5) * 5 + i * 0.1;
    return {
      openTime: i,
      open: price,
      high: price + 2,
      low: price - 2,
      close: price + 0.5,
      volume: 1000 + i * 10,
      closeTime: i + 1,
      quoteVolume: price * 1000,
      trades: 100,
    };
  });
}

describe("indicators", () => {
  it("calculates RSI in valid range", () => {
    const indicators = calculateIndicators(makeCandles(100));
    expect(indicators.rsi).toBeGreaterThanOrEqual(0);
    expect(indicators.rsi).toBeLessThanOrEqual(100);
  });

  it("detects market structure", () => {
    const structure = analyzeMarketStructure(makeCandles(50, 100));
    expect(["Bullish", "Bearish", "Sideways"]).toContain(structure.trend);
  });

  it("calculates support and resistance", () => {
    const candles = makeCandles(100, 1000);
    const levels = calculateLevels(candles, candles[candles.length - 1].close);
    expect(levels.nearestSupport).toBeLessThan(candles[candles.length - 1].close);
    expect(levels.nearestResistance).toBeGreaterThan(candles[candles.length - 1].close);
  });
});
