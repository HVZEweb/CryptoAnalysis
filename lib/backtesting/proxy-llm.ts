/**
 * Technical proxy for LLM vote in backtests (avoids thousands of OpenRouter calls).
 */

import { getHigherTimeframeBias } from "@/lib/prediction-refinement";
import type { AnalysisContext, AnalysisSnapshot, PredictionDirection, PredictionResult } from "@/types";

export function buildProxyLlmPrediction(
  ctx: AnalysisContext,
  snapshot: AnalysisSnapshot
): Omit<PredictionResult, "priceAtPrediction" | "coinId" | "analysis" | "createdAt"> {
  const ind = snapshot.indicators[snapshot.primaryTimeframe];
  const htf = getHigherTimeframeBias(snapshot);
  let direction: PredictionDirection = "SIDEWAYS";
  let probability = 52;

  if (htf === "bullish" && ind?.superTrend.direction === "bullish") {
    direction = "LONG";
    probability = 62;
  } else if (htf === "bearish" && ind?.superTrend.direction === "bearish") {
    direction = "SHORT";
    probability = 62;
  } else if (ind) {
    if (ind.rsi <= 30) {
      direction = "LONG";
      probability = 58;
    } else if (ind.rsi >= 70) {
      direction = "SHORT";
      probability = 58;
    } else if (ind.macd.histogram > 0) {
      direction = "LONG";
      probability = 55;
    } else if (ind.macd.histogram < 0) {
      direction = "SHORT";
      probability = 55;
    }
  }

  const probabilityUp =
    direction === "LONG" ? probability : direction === "SHORT" ? 100 - probability : 50;

  return {
    coin: ctx.coin.name,
    symbol: ctx.coin.symbol,
    market: ctx.market,
    timeframe: ctx.timeframe,
    direction,
    probability,
    probabilityUp,
    probabilityDown: 100 - probabilityUp,
    confidence: probability >= 60 ? "Medium" : "Low",
    priceRange: {
      low: ctx.marketData.price * 0.97,
      high: ctx.marketData.price * 1.03,
    },
    reasons: ["[backtest proxy LLM]"],
    risks: [],
    keyFactors: [],
    recommendation: "[backtest]",
    disclaimer: "Backtest proxy — not a live LLM call.",
  };
}
