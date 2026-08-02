import { describe, expect, it } from "vitest";
import {
  computeTradeLevels,
  formatLevelDelta,
  resolveTradeLevels,
  sanitizeAiTradeLevels,
} from "@/lib/trade-levels";
import type { PredictionResult } from "@/types";

describe("computeTradeLevels", () => {
  it("LONG: TP above entry, SL below", () => {
    const levels = computeTradeLevels({
      direction: "LONG",
      priceAtPrediction: 100,
      priceRange: { low: 95, high: 105 },
    });
    expect(levels.entry).toBe(100);
    expect(levels.tp).toBe(105);
    expect(levels.sl).toBe(95);
  });

  it("SHORT: TP below entry, SL above", () => {
    const levels = computeTradeLevels({
      direction: "SHORT",
      priceAtPrediction: 100,
      priceRange: { low: 95, high: 105 },
    });
    expect(levels.tp).toBe(95);
    expect(levels.sl).toBe(105);
  });

  it("formatLevelDelta shows signed percent", () => {
    expect(formatLevelDelta(100, 105)).toBe("+5.00%");
    expect(formatLevelDelta(100, 95)).toBe("-5.00%");
  });
});

describe("sanitizeAiTradeLevels", () => {
  it("rejects inverted LONG levels", () => {
    expect(
      sanitizeAiTradeLevels({ entry: 100, tp: 90, sl: 110, exit: 100 }, "LONG", 100)
    ).toBeUndefined();
  });

  it("rejects levels too far from price", () => {
    expect(
      sanitizeAiTradeLevels({ entry: 100, tp: 200, sl: 50, exit: 150 }, "LONG", 100)
    ).toBeUndefined();
  });

  it("accepts valid LONG levels", () => {
    const levels = sanitizeAiTradeLevels(
      { entry: 100, tp: 108, sl: 94, exit: 102 },
      "LONG",
      100
    );
    expect(levels?.tp).toBe(108);
    expect(levels?.sl).toBe(94);
  });
});

describe("resolveTradeLevels", () => {
  it("uses priceAtPrediction and S/R for LONG", () => {
    const prediction = {
      direction: "LONG",
      priceAtPrediction: 100,
      priceRange: { low: 95, high: 105 },
      analysis: {
        marketData: { price: 101 },
        levels: { nearestSupport: 96, nearestResistance: 104 },
      },
    } as PredictionResult;

    const levels = resolveTradeLevels(prediction);
    expect(levels.entry).toBe(100);
    expect(levels.sl).toBe(96);
    expect(levels.tp).toBe(104);
  });

  it("ignores invalid AI trade levels and keeps technical levels", () => {
    const prediction = {
      direction: "LONG",
      priceAtPrediction: 100,
      priceRange: { low: 95, high: 105 },
      tradeLevels: { entry: 100, tp: 50, sl: 200, exit: 75 },
      analysis: {
        levels: { nearestSupport: 96, nearestResistance: 104 },
      },
    } as PredictionResult;

    const levels = resolveTradeLevels(prediction);
    expect(levels.sl).toBe(96);
    expect(levels.tp).toBe(104);
  });

  it("card and analysis share the same resolved snapshot", () => {
    const prediction = {
      direction: "SHORT",
      priceAtPrediction: 200,
      priceRange: { low: 190, high: 210 },
      tradeLevels: { entry: 200, tp: 192, sl: 208, exit: 198 },
      analysis: {
        levels: { nearestSupport: 188, nearestResistance: 212 },
      },
    } as PredictionResult;

    const levels = resolveTradeLevels(prediction);
    expect(levels.tp).toBe(192);
    expect(levels.sl).toBe(208);
  });
});
