import { generateOpenRouterPrediction } from "@/services/openrouter";
import type { AnalysisContext, PredictionResult } from "@/types";

type LlmPrediction = Omit<PredictionResult, "priceAtPrediction" | "coinId" | "analysis">;

/**
 * Neutral stand-in when the LLM is unreachable (region block, no key, outage). The LLM carries only
 * 15% of the vote and has no measured accuracy, so the prediction goes on with the validated model
 * and the rules; SIDEWAYS 50% contributes nothing to the vote.
 */
export function neutralLlmPrediction(ctx: AnalysisContext, reason: string): LlmPrediction {
  const price = ctx.marketData.price;
  const atr = ctx.volatility.atr || price * 0.01;
  return {
    coin: ctx.coin.name,
    symbol: ctx.coin.symbol,
    market: ctx.market,
    timeframe: ctx.timeframe,
    direction: "SIDEWAYS",
    probability: 50,
    probabilityUp: 50,
    probabilityDown: 50,
    confidence: "Low",
    priceRange: { low: price - atr, high: price + atr },
    reasons: [],
    risks: [],
    keyFactors: [],
    recommendation: "",
    disclaimer: "Это аналитическая оценка и не является финансовой рекомендацией.",
    createdAt: new Date().toISOString(),
    refinementNotes: [`ИИ-анализ недоступен (${reason}) — прогноз построен на проверенной модели и правилах`],
  };
}

export async function generatePrediction(ctx: AnalysisContext, modelOverride?: string): Promise<LlmPrediction> {
  try {
    return await generateOpenRouterPrediction(ctx, modelOverride);
  } catch (error) {
    const reason = (error as { message?: string })?.message ?? "ошибка запроса";
    console.warn("[ai-prediction] LLM unavailable, continuing without it:", reason);
    return neutralLlmPrediction(ctx, reason);
  }
}
