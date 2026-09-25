/**
 * Ensemble prediction — LLM + ML + rule-based signals with dynamic weighted voting.
 */

import { getHigherTimeframeBias } from "@/lib/prediction-refinement";
import { extractMlFeatures } from "@/services/ml-features";
import { runPricePredictor } from "@/services/predictor";
import {
  DEFAULT_ENSEMBLE_WEIGHTS,
  evaluateMetaLearner,
  resolveDynamicWeightsFromStore,
  type EnsembleWeights,
} from "@/services/ensemble-meta";
import { getCachedMlFeatures, setCachedMlFeatures } from "@/lib/feature-cache";
import type {
  AnalysisContext,
  AnalysisSnapshot,
  ConfidenceLevel,
  EnsembleBreakdown,
  MlPrediction,
  PredictionDirection,
  PredictionResult,
} from "@/types";

const UNAVAILABLE_ML: MlPrediction = {
  direction: "SIDEWAYS",
  probability: 50,
  probabilityUp: 50,
  probabilityDown: 50,
  model: "unavailable",
  confidence: 0,
  keyFeatures: [],
};

export interface RuleSignal {
  direction: PredictionDirection;
  probability: number;
  weight: number;
  reason: string;
}

export interface CombineOptions {
  useDynamicWeights?: boolean;
}

const PROBABILITY_CAP_BY_AGREEMENT: Record<EnsembleBreakdown["agreement"], number> = {
  full: 88,
  partial: 72,
  divergent: 58,
};

/** Calibrated mapping: weak ensemble scores no longer inflate to 90%+. */
export function scoreToDirectionCalibrated(
  score: number,
  agreement: EnsembleBreakdown["agreement"] = "partial"
): { direction: PredictionDirection; probability: number } {
  const abs = Math.abs(score);
  if (abs < 0.08) {
    return { direction: "SIDEWAYS", probability: 50 };
  }
  const raw = 50 + abs * 38;
  const cap = PROBABILITY_CAP_BY_AGREEMENT[agreement];
  const probability = Math.round(Math.min(cap, Math.max(52, raw)));
  return score > 0 ? { direction: "LONG", probability } : { direction: "SHORT", probability };
}

function reconcileEnsembleRecommendation(
  llmDirection: PredictionDirection,
  finalDirection: PredictionDirection,
  probability: number,
  llmRecommendation: string
): { recommendation: string; overrideNote?: string } {
  if (llmDirection === finalDirection) {
    return { recommendation: llmRecommendation };
  }
  const labels: Record<PredictionDirection, string> = {
    LONG: "LONG",
    SHORT: "SHORT",
    SIDEWAYS: "SIDEWAYS",
  };
  const recommendation =
    `Ensemble: ${labels[finalDirection]} ${probability}% ` +
    `(LLM → ${labels[llmDirection]}; направление скорректировано по ML и правилам).`;
  return {
    recommendation,
    overrideNote: llmRecommendation ? `Исходная рекомендация LLM: ${llmRecommendation}` : undefined,
  };
}

export class EnsemblePredictor {
  private readonly weights: EnsembleWeights;

  constructor(weights: Partial<EnsembleWeights> = {}) {
    this.weights = { ...DEFAULT_ENSEMBLE_WEIGHTS, ...weights };
  }

  buildRuleSignals(ctx: AnalysisContext, snapshot: AnalysisSnapshot): RuleSignal[] {
    const signals: RuleSignal[] = [];
    const primaryTf = snapshot.primaryTimeframe;
    const ind = snapshot.indicators[primaryTf];
    const htf = getHigherTimeframeBias(snapshot);
    const regime = ctx.marketRegime ?? snapshot.marketRegime;
    const trendBoost = regime?.regime === "Strong Bull" || regime?.regime === "Strong Bear" ? 1.2 : 1;

    if (htf === "bullish") {
      signals.push({
        direction: "LONG",
        probability: 58,
        weight: 1 * trendBoost,
        reason: "HTF bullish bias",
      });
    } else if (htf === "bearish") {
      signals.push({
        direction: "SHORT",
        probability: 58,
        weight: 1 * trendBoost,
        reason: "HTF bearish bias",
      });
    }

    if (ind) {
      if (ind.rsi >= 72) {
        signals.push({ direction: "SHORT", probability: 55, weight: 0.8, reason: "RSI overbought" });
      } else if (ind.rsi <= 28) {
        signals.push({ direction: "LONG", probability: 55, weight: 0.8, reason: "RSI oversold" });
      }
      if (ind.macd.histogram > 0 && ind.superTrend.direction === "bullish") {
        signals.push({
          direction: "LONG",
          probability: 52,
          weight: 0.6 * trendBoost,
          reason: "MACD+SuperTrend long",
        });
      }
    }

    const fr = ctx.marketData.fundingRate;
    if (fr !== undefined && Math.abs(fr) > 0.0003) {
      signals.push({
        direction: fr > 0 ? "SHORT" : "LONG",
        probability: 54,
        weight: 0.7,
        reason: fr > 0 ? "High positive funding — crowded longs" : "Negative funding — short squeeze risk",
      });
    }

    if (ctx.fearGreed.value >= 78) {
      signals.push({ direction: "SHORT", probability: 53, weight: 0.5, reason: "Extreme greed (F&G)" });
    } else if (ctx.fearGreed.value <= 22) {
      signals.push({ direction: "LONG", probability: 53, weight: 0.5, reason: "Extreme fear (F&G)" });
    }

    if (regime) {
      const w = Math.min(1, regime.confidence / 80);
      switch (regime.regime) {
        case "Strong Bull":
          signals.push({
            direction: "LONG",
            probability: 56,
            weight: 0.9 * w * trendBoost,
            reason: `Regime: Strong Bull (${regime.confidence}%)`,
          });
          break;
        case "Strong Bear":
          signals.push({
            direction: "SHORT",
            probability: 56,
            weight: 0.9 * w * trendBoost,
            reason: `Regime: Strong Bear (${regime.confidence}%)`,
          });
          break;
        case "Mean-Reversion":
          if (ind && ind.rsi >= 68) {
            signals.push({
              direction: "SHORT",
              probability: 54,
              weight: 0.75 * w,
              reason: "Regime: Mean-Reversion (overbought fade)",
            });
          } else if (ind && ind.rsi <= 32) {
            signals.push({
              direction: "LONG",
              probability: 54,
              weight: 0.75 * w,
              reason: "Regime: Mean-Reversion (oversold bounce)",
            });
          }
          break;
        case "Breakout":
          if (regime.score > 0.2) {
            signals.push({
              direction: "LONG",
              probability: 55,
              weight: 0.8 * w,
              reason: "Regime: Breakout bullish",
            });
          } else if (regime.score < -0.2) {
            signals.push({
              direction: "SHORT",
              probability: 55,
              weight: 0.8 * w,
              reason: "Regime: Breakout bearish",
            });
          }
          break;
        case "Low Conviction":
          signals.push({
            direction: "SIDEWAYS",
            probability: 52,
            weight: 0.5 * w,
            reason: "Regime: Low Conviction — reduce directional bias",
          });
          break;
      }
    }

    const delta = ctx.onChainFlow?.orderFlow.deltaImbalance;
    if (delta !== undefined && Math.abs(delta) > 0.2) {
      signals.push({
        direction: delta > 0 ? "LONG" : "SHORT",
        probability: 53,
        weight: 0.55,
        reason: delta > 0 ? "Order flow: taker buy dominance" : "Order flow: taker sell dominance",
      });
    }

    return signals;
  }

  private directionToScore(direction: PredictionDirection, probability: number): number {
    const p = probability / 100;
    if (direction === "LONG") return p;
    if (direction === "SHORT") return -p;
    return 0;
  }

  private scoreToDirection(
    score: number,
    agreement: EnsembleBreakdown["agreement"] = "partial"
  ): { direction: PredictionDirection; probability: number } {
    return scoreToDirectionCalibrated(score, agreement);
  }

  private aggregateRuleSignals(signals: RuleSignal[]): { score: number; reasons: string[] } {
    if (!signals.length) return { score: 0, reasons: [] };
    let num = 0;
    let den = 0;
    const reasons: string[] = [];
    for (const s of signals) {
      num += this.directionToScore(s.direction, s.probability) * s.weight;
      den += s.weight;
      reasons.push(s.reason);
    }
    return { score: den > 0 ? num / den : 0, reasons };
  }

  private resolveEffectiveWeights(
    mlAvailable: boolean,
    nominal: EnsembleWeights
  ): EnsembleWeights {
    if (mlAvailable) return { ...nominal };
    const sum = nominal.llm + nominal.rules;
    return { llm: nominal.llm / sum, ml: 0, rules: nominal.rules / sum };
  }

  private confidenceFromAgreement(
    llm: PredictionResult,
    ml: MlPrediction,
    finalDir: PredictionDirection,
    mlAvailable: boolean,
    regime?: AnalysisContext["marketRegime"]
  ): ConfidenceLevel {
    let c: ConfidenceLevel;
    if (!mlAvailable) {
      c = llm.direction === finalDir ? "Medium" : "Low";
    } else {
      const agree =
        (llm.direction === finalDir ? 1 : 0) +
        (ml.direction === finalDir ? 1 : 0) +
        (finalDir === "SIDEWAYS" ? 0.5 : 0);
      if (agree >= 2) c = "High";
      else if (agree >= 1) c = "Medium";
      else c = "Low";
    }

    if (regime?.htfConflict) {
      if (c === "High") c = "Medium";
      else if (c === "Medium") c = "Low";
    }
    if (regime?.confidenceCap === "Low") c = "Low";
    return c;
  }

  async combine(
    ctx: AnalysisContext,
    snapshot: AnalysisSnapshot,
    llmPrediction: Omit<PredictionResult, "priceAtPrediction" | "coinId" | "analysis" | "createdAt">,
    options: CombineOptions = {}
  ): Promise<{
    prediction: Omit<PredictionResult, "priceAtPrediction" | "coinId" | "analysis" | "createdAt">;
    breakdown: EnsembleBreakdown;
  }> {
    const cacheKey = `${ctx.coin.symbol}:${ctx.timeframe}:${ctx.marketData.price}`;
    let features = await getCachedMlFeatures(cacheKey);
    if (!features) {
      features = extractMlFeatures(ctx);
      await setCachedMlFeatures(cacheKey, features).catch(() => undefined);
    }

    const predictorRun = runPricePredictor(ctx);
    const mlAvailable = predictorRun.result?.ml != null;
    const ml = predictorRun.result?.ml ?? UNAVAILABLE_ML;

    const rules = this.buildRuleSignals(ctx, snapshot);
    const ruleAgg = this.aggregateRuleSignals(rules);

    const llmScore = this.directionToScore(llmPrediction.direction, llmPrediction.probability);
    const mlScore = mlAvailable ? this.directionToScore(ml.direction, ml.probability) : 0;

    const preAgreement: EnsembleBreakdown["agreement"] =
      !mlAvailable
        ? "partial"
        : llmPrediction.direction === ml.direction
          ? "full"
          : llmPrediction.direction === "SIDEWAYS" || ml.direction === "SIDEWAYS"
            ? "partial"
            : "divergent";

    const nominalWeights =
      options.useDynamicWeights !== false
        ? await resolveDynamicWeightsFromStore(ctx.marketRegime ?? snapshot.marketRegime, preAgreement)
        : { ...this.weights };

    const effectiveWeights = this.resolveEffectiveWeights(mlAvailable, nominalWeights);

    const ensembleScore =
      llmScore * effectiveWeights.llm +
      mlScore * effectiveWeights.ml +
      ruleAgg.score * effectiveWeights.rules;

    let { direction, probability } = this.scoreToDirection(ensembleScore, preAgreement);
    let probabilityUp =
      direction === "LONG" ? probability : direction === "SHORT" ? 100 - probability : 50;
    let probabilityDown = 100 - probabilityUp;

    const regime = ctx.marketRegime ?? snapshot.marketRegime;
    let confidence = this.confidenceFromAgreement(
      llmPrediction as PredictionResult,
      ml,
      direction,
      mlAvailable,
      regime
    );

    const breakdown: EnsembleBreakdown = {
      weights: { ...this.weights },
      effectiveWeights,
      dynamicWeightsUsed: options.useDynamicWeights !== false,
      mlAvailable,
      mlError: predictorRun.error,
      llm: {
        direction: llmPrediction.direction,
        probability: llmPrediction.probability,
        score: llmScore,
      },
      ml,
      rules: rules.map((r) => ({
        direction: r.direction,
        probability: r.probability,
        reason: r.reason,
      })),
      rulesAggregateScore: Math.round(ruleAgg.score * 1000) / 1000,
      ensembleScore: Math.round(ensembleScore * 1000) / 1000,
      agreement:
        !mlAvailable
          ? llmPrediction.direction === direction
            ? "partial"
            : "divergent"
          : llmPrediction.direction === ml.direction
            ? "full"
            : llmPrediction.direction === direction || ml.direction === direction
              ? "partial"
              : "divergent",
      finalDirection: direction,
      finalProbability: probability,
    };

    const meta = evaluateMetaLearner(breakdown, regime);
    breakdown.metaTrustScore = meta.trustScore;
    breakdown.lowConfidence = meta.lowConfidence;

    if (meta.suppressPrediction || regime?.suppressTrade) {
      direction = "SIDEWAYS";
      probability = 50;
      probabilityUp = 50;
      probabilityDown = 50;
      confidence = "Low";
      breakdown.finalDirection = direction;
      breakdown.finalProbability = probability;
    } else if (meta.lowConfidence && confidence === "High") {
      confidence = "Medium";
    }

    const keyFeatures = mlAvailable
      ? [...new Set([...ml.keyFeatures, ...features.labels.slice(0, 4)])].slice(0, 8)
      : features.labels.slice(0, 6);

    const ensembleReasons = [
      mlAvailable
        ? `Ensemble: LLM ${(llmScore * 100).toFixed(0)}% + ML(${ml.model}) ${(mlScore * 100).toFixed(0)}% + rules`
        : `Ensemble: LLM ${(llmScore * 100).toFixed(0)}% + rules (ML недоступен)`,
      meta.lowConfidence ? `Meta: низкая уверенность (${meta.reason})` : `Meta trust: ${meta.trustScore}%`,
      ...ruleAgg.reasons.slice(0, 2),
    ];

    const { recommendation, overrideNote } = reconcileEnsembleRecommendation(
      llmPrediction.direction,
      direction,
      probability,
      llmPrediction.recommendation
    );

    const refinementNotes = [
      ...(llmPrediction.refinementNotes ?? []),
      overrideNote,
      mlAvailable
        ? `ML model: ${ml.model} → ${ml.direction} ${ml.probability}% (точность на истории ${ml.validationAccuracy}%)`
        : `ML недоступен (${predictorRun.error}) — ensemble: LLM + rules (${(effectiveWeights.llm * 100).toFixed(0)}% / ${(effectiveWeights.rules * 100).toFixed(0)}%)`,
      options.useDynamicWeights !== false ? "Dynamic weights applied from regime profile" : undefined,
    ].filter(Boolean) as string[];

    const merged = {
      ...llmPrediction,
      direction,
      probability,
      probabilityUp,
      probabilityDown,
      confidence,
      recommendation,
      ensembleScore: breakdown.ensembleScore,
      keyFeatures: [...keyFeatures, ...(llmPrediction.keyFactors ?? []).slice(0, 3)],
      reasons: [...ensembleReasons, ...(llmPrediction.reasons ?? []).slice(0, 4)],
      refinementNotes,
      lowConfidence: meta.lowConfidence,
      metaTrustScore: meta.trustScore,
      ...(predictorRun.result ? { priceForecast: predictorRun.result.priceForecast } : {}),
    };

    return { prediction: merged, breakdown };
  }
}

export const ensemblePredictor = new EnsemblePredictor();
