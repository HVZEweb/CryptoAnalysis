import { describe, expect, it } from "vitest";
import { evaluatePredictionAccuracy, evaluatePredictionAccuracyFromPrices, dedupeHistoryItems, historyDedupKey } from "@/lib/utils";

const baseForecast = {
  predictedPrice: 102_000,
  predictedHigh: 103_000,
  predictedLow: 99_000,
  confidenceBand: { low: 101_500, high: 102_500 },
  expectedMovePct: 2,
};

describe("evaluatePredictionAccuracy", () => {
  const now = new Date().toISOString();

  it("marks recent 24h prediction as in progress", () => {
    const result = evaluatePredictionAccuracy("LONG", 100_000, 100_050, {
      timeframe: "24h",
      createdAt: now,
      priceForecast: baseForecast,
    });
    expect(result.label).toBe("В процессе");
    expect(result.isCorrect).toBeNull();
    expect(result.timeframePhase).toBe("in_progress");
  });

  it("marks accurate price target as correct when timeframe completed", () => {
    const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
    const result = evaluatePredictionAccuracyFromPrices(
      {
        direction: "LONG",
        priceAtPrediction: 100_000,
        timeframe: "24h",
        createdAt: old,
        priceForecast: baseForecast,
        priceRange: { low: 99_000, high: 103_000 },
      },
      102_100
    );
    expect(result.label).toBe("Точно");
    expect(result.isCorrect).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(72);
    expect(result.timeframePhase).toBe("completed");
  });

  it("marks a small move the wrong way as a miss, not 'Частично' (the reported ETH 15m case)", () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const result = evaluatePredictionAccuracyFromPrices(
      {
        direction: "LONG",
        priceAtPrediction: 2723.71,
        timeframe: "15m",
        createdAt: old,
        priceForecast: {
          predictedPrice: 2724.5,
          predictedHigh: 2739,
          predictedLow: 2707,
          confidenceBand: { low: 2716, high: 2733 },
          expectedMovePct: 0.03,
        },
        priceRange: { low: 2707, high: 2739 },
      },
      2718.47
    );
    expect(result.timeframePhase).toBe("completed");
    expect(result.label).toBe("Мимо");
    expect(result.isCorrect).toBe(false);
  });

  it("marks large price miss as wrong when completed", () => {
    const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
    const result = evaluatePredictionAccuracyFromPrices(
      {
        direction: "LONG",
        priceAtPrediction: 100_000,
        timeframe: "24h",
        createdAt: old,
        priceForecast: baseForecast,
      },
      96_000
    );
    expect(result.label).toBe("Мимо");
    expect(result.isCorrect).toBe(false);
  });

  it("rewards close price forecast within confidence band", () => {
    const old = new Date(Date.now() - 5 * 60 * 60_000).toISOString();
    const result = evaluatePredictionAccuracyFromPrices(
      {
        direction: "LONG",
        priceAtPrediction: 100_000,
        timeframe: "4h",
        createdAt: old,
        priceForecast: {
          predictedPrice: 100_500,
          predictedHigh: 101_000,
          predictedLow: 99_500,
          confidenceBand: { low: 100_200, high: 100_800 },
          expectedMovePct: 0.5,
        },
        priceRange: { low: 99_500, high: 101_000 },
      },
      100_450
    );
    expect(result.score).toBeGreaterThanOrEqual(72);
    expect(result.breakdown.band).toBe(100);
  });

  it("dedupes local and server copies of the same prediction", () => {
    const base = {
      symbol: "BTC",
      market: "Futures",
      timeframe: "15m",
      direction: "LONG",
      priceAtPrediction: 63745.2,
    };
    const local = { ...base, createdAt: "2026-07-06T16:30:00.123Z" };
    const server = { ...base, createdAt: "2026-07-06T16:30:00.000Z" };
    expect(historyDedupKey(local)).toBe(historyDedupKey(server));
    expect(dedupeHistoryItems([local, server])).toHaveLength(1);
  });
});
