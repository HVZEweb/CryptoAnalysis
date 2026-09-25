/**
 * Ensemble prediction — combines the validated price model with the LLM and rule signals.
 *
 * Every vote is converted to an edge over a coin flip (2p − 1), so "LONG 58%" counts as +0.16,
 * not +0.58. Only the price model has measured out-of-sample accuracy, so it carries most of the
 * weight, and the final probability is capped at the accuracy the model actually achieved in
 * walk-forward validation. Without a validated edge no direction is given at all.
 */

import { getHigherTimeframeBias } from "@/lib/prediction-refinement";
import { extractMlFeatures } from "@/services/ml-features";
import { runPricePredictor } from "@/services/predictor";
import { strategySignal } from "@/services/strategy-lab/signal";
import { SIDEWAYS_BAND } from "@/services/predictor/config";
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

/** The LLM and the rules have no measured accuracy, so they can only nudge the model. */
export const SOURCE_WEIGHTS = { ml: 0.7, llm: 0.15, rules: 0.15 } as const;

/** Smallest |P(up) − 0.5| that is still reported as a direction. */
export const MIN_DIRECTION_EDGE = 0.02;

/** Never claim more than this over 50%, whatever validation says. */
const MAX_EDGE_CAP = 0.1;

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

/** Signed edge over a coin flip: LONG 58% → +0.16, SHORT 58% → −0.16, SIDEWAYS → 0. */
export function directionEdge(direction: PredictionDirection, probabilityPct: number): number {
  const strength = Math.max(0, Math.min(1, (2 * probabilityPct) / 100 - 1));
  if (direction === "LONG") return strength;
  if (direction === "SHORT") return -strength;
  return 0;
}

/**
 * Turns P(up) into a call. `cap` is the largest allowed distance from 50%
 * (validated accuracy − 0.5); a cap of 0 means no direction can be given.
 */
export function probabilityToCall(
  pUp: number,
  cap: number
): { direction: PredictionDirection; probability: number; probabilityUp: number } {
  const limit = Math.max(0, Math.min(MAX_EDGE_CAP, cap));
  const clamped = 0.5 + Math.max(-limit, Math.min(limit, pUp - 0.5));
  const probabilityUp = Math.round(clamped * 1000) / 10;
  if (clamped - 0.5 >= MIN_DIRECTION_EDGE) {
    return { direction: "LONG", probability: probabilityUp, probabilityUp };
  }
  if (0.5 - clamped >= MIN_DIRECTION_EDGE) {
    return { direction: "SHORT", probability: Math.round((100 - probabilityUp) * 10) / 10, probabilityUp };
  }
  return { direction: "SIDEWAYS", probability: 50, probabilityUp };
}

function sign(edge: number): number {
  if (edge >= MIN_DIRECTION_EDGE * 2) return 1;
  if (edge <= -MIN_DIRECTION_EDGE * 2) return -1;
  return 0;
}

function agreementOf(edges: number[]): EnsembleBreakdown["agreement"] {
  const signs = edges.map(sign).filter((s) => s !== 0);
  if (signs.length < 2) return "partial";
  if (signs.every((s) => s === signs[0])) return signs.length === edges.length ? "full" : "partial";
  return "divergent";
}

export class EnsemblePredictor {
  buildRuleSignals(ctx: AnalysisContext, snapshot: AnalysisSnapshot): RuleSignal[] {
    const signals: RuleSignal[] = [];
    const primaryTf = snapshot.primaryTimeframe;
    const ind = snapshot.indicators[primaryTf];
    const htf = getHigherTimeframeBias(snapshot);
    const regime = ctx.marketRegime ?? snapshot.marketRegime;

    if (htf === "bullish") {
      signals.push({
        direction: "LONG",
        probability: 58,
        weight: 1,
        reason: "HTF bullish bias",
      });
    } else if (htf === "bearish") {
      signals.push({
        direction: "SHORT",
        probability: 58,
        weight: 1,
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
        signals.push({ direction: "LONG", probability: 52, weight: 0.6, reason: "MACD+SuperTrend long" });
      } else if (ind.macd.histogram < 0 && ind.superTrend.direction === "bearish") {
        signals.push({ direction: "SHORT", probability: 52, weight: 0.6, reason: "MACD+SuperTrend short" });
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
          // The HTF signal above already encodes the same trend — don't count it twice.
          if (htf === "bullish") break;
          signals.push({
            direction: "LONG",
            probability: 56,
            weight: 0.9 * w,
            reason: `Regime: Strong Bull (${regime.confidence}%)`,
          });
          break;
        case "Strong Bear":
          if (htf === "bearish") break;
          signals.push({
            direction: "SHORT",
            probability: 56,
            weight: 0.9 * w,
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

  private aggregateRuleSignals(signals: RuleSignal[]): { edge: number; reasons: string[] } {
    if (!signals.length) return { edge: 0, reasons: [] };
    let num = 0;
    let den = 0;
    for (const s of signals) {
      num += directionEdge(s.direction, s.probability) * s.weight;
      den += s.weight;
    }
    return { edge: den > 0 ? num / den : 0, reasons: signals.map((s) => s.reason) };
  }

  async combine(
    ctx: AnalysisContext,
    snapshot: AnalysisSnapshot,
    llmPrediction: Omit<PredictionResult, "priceAtPrediction" | "coinId" | "analysis" | "createdAt">
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

    const predictorRun = await runPricePredictor(ctx);
    const model = predictorRun.result;
    const validation = model?.model.validation;
    const hasEdge = validation?.hasEdge === true;

    // The model's own P(up) is used even inside its sideways band — 48% is a (weak) vote for down.
    const mlEdge = model ? 2 * model.probabilityUp - 1 : 0;
    const llmEdge = directionEdge(llmPrediction.direction, llmPrediction.probability);
    const rules = this.buildRuleSignals(ctx, snapshot);
    const ruleAgg = this.aggregateRuleSignals(rules);

    const effectiveWeights = {
      ml: hasEdge ? SOURCE_WEIGHTS.ml : 0,
      llm: SOURCE_WEIGHTS.llm,
      rules: SOURCE_WEIGHTS.rules,
    };
    const totalWeight = effectiveWeights.ml + effectiveWeights.llm + effectiveWeights.rules;
    const ensembleEdge =
      (effectiveWeights.ml * mlEdge + effectiveWeights.llm * llmEdge + effectiveWeights.rules * ruleAgg.edge) /
      totalWeight;

    // Cap = what the model proved on unseen data for its confident calls; no validated edge → no direction.
    const cap = hasEdge && validation ? validation.confident.accuracy - 0.5 : 0;
    let call = probabilityToCall(0.5 + ensembleEdge / 2, cap);
    // The LLM and the rules may strengthen or weaken the model's call, but not create one: when the
    // model itself leans nowhere (or the other way), their unmeasured votes alone set no direction.
    const modelSide = sign(mlEdge);
    const callSide = call.direction === "LONG" ? 1 : call.direction === "SHORT" ? -1 : 0;
    const vetoedByModel = callSide !== 0 && modelSide !== callSide;
    if (vetoedByModel) call = { direction: "SIDEWAYS", probability: 50, probabilityUp: 50 };
    // A setup that made money after fees on unseen history trades the model's side, even where the
    // direction test alone was inconclusive: profit on the holdout is the stricter check.
    const strategy = strategySignal(model, ctx.marketData.price);
    const strategyOverride = strategy.status === "trade" && strategy.side !== call.direction;
    if (strategyOverride && model) {
      const up = Math.round(model.probabilityUp * 1000) / 10;
      call = { direction: strategy.side!, probability: strategy.side === "LONG" ? up : Math.round((100 - up) * 10) / 10, probabilityUp: up };
    }
    const { direction, probability } = call;
    const probabilityUp = call.probabilityUp;
    const probabilityDown = Math.round((100 - probabilityUp) * 10) / 10;

    const agreement = agreementOf(hasEdge ? [mlEdge, llmEdge, ruleAgg.edge] : [llmEdge, ruleAgg.edge]);
    const distance = Math.abs(probabilityUp - 50) / 100;
    // Validated accuracy tops out around 55%, so "High" would overstate any call.
    const confidence: ConfidenceLevel =
      direction !== "SIDEWAYS" && distance >= 0.03 && agreement === "full" ? "Medium" : "Low";
    const lowConfidence = direction === "SIDEWAYS" || distance < 0.03;
    const trustScore = hasEdge && validation ? Math.round(validation.confident.accuracy * 100) : 50;

    const mlBreakdown: MlPrediction = model
      ? {
          direction: model.probabilityUp - 0.5 >= SIDEWAYS_BAND ? "LONG" : 0.5 - model.probabilityUp >= SIDEWAYS_BAND ? "SHORT" : "SIDEWAYS",
          probability: Math.round(Math.max(model.probabilityUp, 1 - model.probabilityUp) * 1000) / 10,
          probabilityUp: Math.round(model.probabilityUp * 1000) / 10,
          probabilityDown: Math.round((1 - model.probabilityUp) * 1000) / 10,
          model: `predictor_${model.model.timeframe}`,
          confidence: Math.round(Math.abs(model.probabilityUp - 0.5) * 2000) / 10,
          keyFeatures: model.topFeatures.map((f) => `${f.label} ${f.contribution > 0 ? "↑" : "↓"}`),
          source: "predictor",
          validationAccuracy: validation ? Math.round(validation.accuracy * 1000) / 10 : undefined,
        }
      : UNAVAILABLE_ML;

    const round3 = (n: number) => Math.round(n * 1000) / 1000;
    const breakdown: EnsembleBreakdown = {
      weights: { ...SOURCE_WEIGHTS },
      effectiveWeights: {
        ml: round3(effectiveWeights.ml / totalWeight),
        llm: round3(effectiveWeights.llm / totalWeight),
        rules: round3(effectiveWeights.rules / totalWeight),
      },
      dynamicWeightsUsed: false,
      mlAvailable: hasEdge,
      mlError: predictorRun.error,
      llm: { direction: llmPrediction.direction, probability: llmPrediction.probability, score: round3(llmEdge) },
      ml: mlBreakdown,
      rules: rules.map((r) => ({ direction: r.direction, probability: r.probability, reason: r.reason })),
      rulesAggregateScore: round3(ruleAgg.edge),
      ensembleScore: round3(ensembleEdge),
      agreement,
      finalDirection: direction,
      finalProbability: probability,
      metaTrustScore: trustScore,
      lowConfidence,
    };

    const pct = (edge: number) => `${edge >= 0 ? "+" : ""}${(edge * 50).toFixed(1)} п.п.`;
    const validatedNote = validation
      ? `точность модели на истории ${(validation.accuracy * 100).toFixed(1)}% (уверенные сигналы ${(validation.confident.accuracy * 100).toFixed(1)}%)`
      : "модель не обучена";
    const ensembleReasons = [
      `Голоса (отклонение от 50%): модель ${pct(mlEdge)} · ИИ ${pct(llmEdge)} · правила ${pct(ruleAgg.edge)}`,
      `Вес: модель ${Math.round(breakdown.effectiveWeights.ml * 100)}%, ИИ ${Math.round(breakdown.effectiveWeights.llm * 100)}%, правила ${Math.round(breakdown.effectiveWeights.rules * 100)}% — ${validatedNote}`,
      ...ruleAgg.reasons.slice(0, 2),
    ];

    let recommendation = llmPrediction.recommendation;
    const refinementNotes = [...(llmPrediction.refinementNotes ?? [])];
    if (!hasEdge) {
      recommendation =
        `Направление не прогнозируется: на таймфрейме ${ctx.timeframe} модель не показала преимущества над случайным угадыванием на истории. ` +
        `Ориентируйтесь на ценовой коридор.`;
      refinementNotes.push(`Нет подтверждённого преимущества на ${ctx.timeframe} (${predictorRun.error ?? "validation"}) — направление скрыто`);
    } else if (vetoedByModel) {
      recommendation =
        `Сигнала нет: модель не видит перевеса (${(model!.probabilityUp * 100).toFixed(1)}% за рост), ` +
        `а направление ИИ и правил без неё не подтверждено историей.`;
      refinementNotes.push("ИИ и правила указывали направление, но модель его не подтверждает — направление не даётся");
    } else if (direction === "SIDEWAYS") {
      recommendation = "Сигнала нет: перевес любой из сторон меньше порога, подтверждённого на истории.";
    } else if (llmPrediction.direction !== direction) {
      refinementNotes.push(`ИИ предлагал ${llmPrediction.direction}; итог определяет проверенная модель`);
      recommendation = `${direction} ${probability}% по проверенной модели (ИИ: ${llmPrediction.direction}).`;
    }
    if (strategyOverride) {
      refinementNotes.push(`Направление ${direction} задаёт проверенная стратегия сделок модели`);
    } else if (hasEdge && validation && direction !== "SIDEWAYS") {
      refinementNotes.push(`Вероятность ограничена подтверждённой точностью ${(validation.confident.accuracy * 100).toFixed(1)}%`);
    }

    const keyFeatures = [...new Set([...mlBreakdown.keyFeatures, ...features.labels.slice(0, 4)])].slice(0, 8);

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
      lowConfidence,
      metaTrustScore: trustScore,
      strategy,
      ...(model ? { priceForecast: model.priceForecast } : {}),
    };

    return { prediction: merged, breakdown };
  }
}

export const ensemblePredictor = new EnsemblePredictor();
