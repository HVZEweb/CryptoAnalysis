import type { PredictionResult, PriceForecast } from "@/types";

/** Целевая цена из прогноза или fallback для старых записей. */
export function resolvePriceForecast(
  prediction: Pick<
    PredictionResult,
    "priceAtPrediction" | "priceRange" | "tradeLevels" | "direction"
  > & { priceForecast?: PriceForecast }
): PriceForecast {
  if (prediction.priceForecast) {
    return prediction.priceForecast;
  }

  const entry = prediction.priceAtPrediction;
  const range = prediction.priceRange ?? {
    low: entry * 0.98,
    high: entry * 1.02,
  };
  const { low, high } = range;
  const mid = (low + high) / 2;
  const predictedPrice = prediction.tradeLevels?.exit ?? mid;
  const bandHalf = Math.max(Math.abs(predictedPrice - low), Math.abs(high - predictedPrice)) * 0.35;

  return {
    predictedPrice,
    predictedHigh: high,
    predictedLow: low,
    confidenceBand: {
      low: Math.min(predictedPrice - bandHalf, predictedPrice),
      high: Math.max(predictedPrice + bandHalf, predictedPrice),
    },
    expectedMovePct: entry > 0 ? ((predictedPrice - entry) / entry) * 100 : 0,
  };
}

export function formatMovePct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}
