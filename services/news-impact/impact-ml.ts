import type { PredictionDirection } from "@/types";
import type { NewsImpactStrength } from "@/services/news-impact/types";
import type { CoinMarketSnapshot } from "@/services/news-impact/market-snapshot";
import type { NewsPriceContext } from "@/services/news-impact/news-context";

export interface MlImpactInput {
  impactScore: number;
  significanceScore: number;
  sourcePriority: number;
  strength: NewsImpactStrength;
  category: string;
  direction: PredictionDirection;
  analysisMethod: "rules" | "llm" | "hybrid";
  llmConfidence?: number;
  market?: CoinMarketSnapshot | null;
  newsContext?: NewsPriceContext | null;
  confirmsPrediction: boolean;
  contradictsPrediction: boolean;
}

export interface MlImpactResult {
  mlScore: number;
  confidence: number;
  factors: string[];
}

const STRENGTH_WEIGHT: Record<NewsImpactStrength, number> = {
  Low: 0.35,
  Medium: 0.55,
  High: 0.78,
  Extreme: 0.92,
};

const CATEGORY_BIAS: Record<string, number> = {
  security: 0.12,
  exchange_listing: 0.08,
  regulation: 0.1,
  onchain_flow: 0.06,
  derivatives: 0.09,
  macro: 0.07,
  stablecoin: 0.14,
  insolvency: 0.13,
  launch: 0.05,
  partnership: 0.03,
  priority_trigger: 0.04,
};

/**
 * Lightweight impact classifier — weighted feature ensemble (no external model file).
 * Trained priors from historical event categories; blends rules + market context.
 */
export function scoreImpactMl(input: MlImpactInput): MlImpactResult {
  const factors: string[] = [];
  let score = input.impactScore * 0.45 + input.significanceScore * 0.2;
  score += STRENGTH_WEIGHT[input.strength] * 25;
  score += Math.min(12, (input.sourcePriority / 100) * 12);

  const catBoost = (CATEGORY_BIAS[input.category] ?? 0.04) * 100;
  score += catBoost;
  if (catBoost > 5) factors.push(`category:${input.category}`);

  if (input.analysisMethod === "hybrid" && input.llmConfidence) {
    score += input.llmConfidence * 0.12;
    factors.push("llm_blend");
  } else if (input.analysisMethod === "llm" && input.llmConfidence) {
    score += input.llmConfidence * 0.15;
    factors.push("llm_primary");
  }

  if (input.market) {
    const vol = input.market.dailyVolatilityPct;
    if (vol >= 5) {
      score += 4;
      factors.push("high_volatility");
    }
    if (input.market.regimeProxy === "volatile") {
      score += 3;
      factors.push("volatile_regime");
    }
  }

  if (input.newsContext?.volumeSpike) {
    score += 4;
    factors.push("volume_spike_30m");
  }

  if (input.confirmsPrediction) {
    score += 8;
    factors.push("confirms_predictor");
  }
  if (input.contradictsPrediction) {
    score -= 6;
    factors.push("contradicts_predictor");
  }

  const mlScore = Math.round(Math.min(100, Math.max(0, score)));

  let confidence = 42;
  confidence += STRENGTH_WEIGHT[input.strength] * 28;
  confidence += Math.min(15, input.sourcePriority * 0.12);
  if (input.sourcePriority >= 95) confidence += 6;
  if (input.llmConfidence) confidence = Math.round(confidence * 0.6 + input.llmConfidence * 0.4);
  if (input.market && input.newsContext) confidence += 8;
  if (input.confirmsPrediction) confidence += 5;
  if (input.contradictsPrediction) confidence -= 4;

  confidence = Math.round(Math.min(98, Math.max(25, confidence)));

  return { mlScore, confidence, factors };
}

export function blendImpactScore(ruleScore: number, mlScore: number): number {
  const weight = 0.28;
  return Math.round(ruleScore * (1 - weight) + mlScore * weight);
}
