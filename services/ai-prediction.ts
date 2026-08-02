import { generateOpenRouterPrediction } from "@/services/openrouter";
import type { AnalysisContext, PredictionResult } from "@/types";

export async function generatePrediction(
  ctx: AnalysisContext,
  modelOverride?: string
): Promise<Omit<PredictionResult, "priceAtPrediction" | "coinId" | "analysis">> {
  return generateOpenRouterPrediction(ctx, modelOverride);
}
