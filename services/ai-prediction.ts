import { generateOpenRouterPrediction } from "@/services/openrouter";
import type { AnalysisContext, PredictionResult } from "@/types";

type LlmPrediction = Omit<PredictionResult, "priceAtPrediction" | "coinId" | "analysis">;

/**
 * Neutral stand-in when the LLM is unreachable or switched off (region block, no key, outage,
 * PREDICTION_LLM=off). The LLM has no vote in the direction, so the prediction is the same; only
 * its text explanation is missing.
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

/**
 * PREDICTION_LLM=off skips the LLM entirely: it has no vote in the direction (see ensemble-prediction),
 * only writes the text explanation, and a request takes 1–3 minutes and costs money.
 */
export function llmEnabled(): boolean {
  return process.env.PREDICTION_LLM?.trim().toLowerCase() !== "off";
}

export async function generatePrediction(ctx: AnalysisContext, modelOverride?: string): Promise<LlmPrediction> {
  if (!llmEnabled()) return neutralLlmPrediction(ctx, "выключен настройкой PREDICTION_LLM=off");
  try {
    return await generateOpenRouterPrediction(ctx, modelOverride);
  } catch (error) {
    const reason = (error as { message?: string })?.message ?? "ошибка запроса";
    console.warn("[ai-prediction] LLM unavailable, continuing without it:", reason);
    return neutralLlmPrediction(ctx, reason);
  }
}
