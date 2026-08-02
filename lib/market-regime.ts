/**
 * Market regime detection — classifies current conditions for ensemble + ML.
 */

import { getHigherTimeframeBias } from "@/lib/prediction-refinement";
import type {
  AnalysisContext,
  AnalysisSnapshot,
  ConfidenceLevel,
  MarketRegime,
  MarketRegimeType,
  TechnicalIndicators,
} from "@/types";

interface RegimeCandidate {
  regime: MarketRegimeType;
  score: number;
  signals: string[];
  bias: number;
}

function primaryIndicators(ctx: AnalysisContext, snapshot: AnalysisSnapshot): TechnicalIndicators | undefined {
  const tf = snapshot.primaryTimeframe;
  return ctx.indicators[tf] ?? Object.values(ctx.indicators)[0];
}

function fundingExtreme(fundingRate?: number): boolean {
  if (fundingRate === undefined) return false;
  return Math.abs(fundingRate) > 0.0004;
}

function bbEdge(ind: TechnicalIndicators, price: number): "upper" | "lower" | "mid" {
  const { upper, lower, middle } = ind.bollingerBands;
  const range = upper - lower;
  if (range <= 0) return "mid";
  const pos = (price - middle) / (range / 2);
  if (pos >= 0.75) return "upper";
  if (pos <= -0.75) return "lower";
  return "mid";
}

/**
 * Detect market regime from ADX, SuperTrend, HTF bias, volatility, funding, order flow.
 */
export function detectMarketRegime(
  ctx: AnalysisContext,
  snapshot: AnalysisSnapshot
): MarketRegime {
  const ind = primaryIndicators(ctx, snapshot);
  const price = ctx.marketData.price;
  const htf = getHigherTimeframeBias(snapshot);
  const funding = ctx.onChainFlow?.fundingOi.fundingRate ?? ctx.marketData.fundingRate;
  const oiChg = ctx.onChainFlow?.fundingOi.openInterestChange24hPct ?? 0;
  const delta = ctx.onChainFlow?.orderFlow.deltaImbalance ?? 0;
  const volDaily = ctx.volatility.dailyVolatility;
  const ms = ctx.marketStructure;

  const candidates: RegimeCandidate[] = [];

  if (ind) {
    const stBull = ind.superTrend.direction === "bullish";
    const stBear = ind.superTrend.direction === "bearish";
    const adxStrong = ind.adx >= 25;
    const adxWeak = ind.adx < 20;
    const rsiHigh = ind.rsi >= 68;
    const rsiLow = ind.rsi <= 32;

    let bullScore = 0;
    const bullSignals: string[] = [];
    if (adxStrong) { bullScore += 2; bullSignals.push(`ADX ${ind.adx.toFixed(0)} — сильный тренд`); }
    if (stBull) { bullScore += 2; bullSignals.push("SuperTrend bullish"); }
    if (htf === "bullish") { bullScore += 2; bullSignals.push("HTF bullish bias"); }
    if (ms.trend === "Bullish") { bullScore += 1; bullSignals.push("Структура Bullish"); }
    if (delta > 0.15) { bullScore += 1; bullSignals.push("Положительный delta imbalance"); }
    if (funding !== undefined && funding > 0 && funding < 0.0005) {
      bullScore += 0.5;
      bullSignals.push("Funding умеренно позитивный");
    }
    if (fundingExtreme(funding) && funding! > 0) {
      bullScore -= 1;
      bullSignals.push("Экстремальный funding — перегретые лонги");
    }
    candidates.push({ regime: "Strong Bull", score: bullScore, signals: bullSignals, bias: 0.75 });

    let bearScore = 0;
    const bearSignals: string[] = [];
    if (adxStrong) { bearScore += 2; bearSignals.push(`ADX ${ind.adx.toFixed(0)} — сильный тренд`); }
    if (stBear) { bearScore += 2; bearSignals.push("SuperTrend bearish"); }
    if (htf === "bearish") { bearScore += 2; bearSignals.push("HTF bearish bias"); }
    if (ms.trend === "Bearish") { bearScore += 1; bearSignals.push("Структура Bearish"); }
    if (delta < -0.15) { bearScore += 1; bearSignals.push("Отрицательный delta imbalance"); }
    if (funding !== undefined && funding < 0) {
      bearScore += 0.5;
      bearSignals.push("Отрицательный funding");
    }
    candidates.push({ regime: "Strong Bear", score: bearScore, signals: bearSignals, bias: -0.75 });

    let mrScore = 0;
    const mrSignals: string[] = [];
    if (adxWeak) { mrScore += 2; mrSignals.push(`ADX ${ind.adx.toFixed(0)} — слабый тренд`); }
    if (rsiHigh || rsiLow) {
      mrScore += 2;
      mrSignals.push(rsiHigh ? `RSI перекуплен (${ind.rsi.toFixed(0)})` : `RSI перепродан (${ind.rsi.toFixed(0)})`);
    }
    if (fundingExtreme(funding)) {
      mrScore += 1.5;
      mrSignals.push("Экстремальный funding — mean-reversion");
    }
    if (ms.trend === "Sideways") { mrScore += 1; mrSignals.push("Боковая структура"); }
    const edge = bbEdge(ind, price);
    if (edge !== "mid") {
      mrScore += 1;
      mrSignals.push(edge === "upper" ? "Цена у верхней BB" : "Цена у нижней BB");
    }
    candidates.push({
      regime: "Mean-Reversion",
      score: mrScore,
      signals: mrSignals,
      bias: rsiHigh || edge === "upper" ? -0.4 : rsiLow || edge === "lower" ? 0.4 : 0,
    });

    let boScore = 0;
    const boSignals: string[] = [];
    if (ind.adx >= 20 && ind.adx < 35) {
      boScore += 1;
      boSignals.push(`ADX ${ind.adx.toFixed(0)} — нарастающий импульс`);
    }
    if (ctx.volumeAnalysis.anomalousVolume) {
      boScore += 2;
      boSignals.push("Аномальный объём");
    }
    if (edge === "upper" && stBull) {
      boScore += 2;
      boSignals.push("Пробой верхней BB + bullish ST");
    }
    if (edge === "lower" && stBear) {
      boScore += 2;
      boSignals.push("Пробой нижней BB + bearish ST");
    }
    if (Math.abs(oiChg) > 5) {
      boScore += 1;
      boSignals.push(`OI change ${oiChg.toFixed(1)}%`);
    }
    if (Math.abs(delta) > 0.25) {
      boScore += 1;
      boSignals.push("Сильный order-flow delta");
    }
    const boBias =
      edge === "upper" && stBull ? 0.6 : edge === "lower" && stBear ? -0.6 : delta > 0 ? 0.35 : delta < 0 ? -0.35 : 0;
    candidates.push({ regime: "Breakout", score: boScore, signals: boSignals, bias: boBias });
  }

  let lowScore = 1;
  const lowSignals: string[] = ["Смешанные сигналы"];
  if (ind && ind.adx < 18) {
    lowScore += 2;
    lowSignals.push(`ADX ${ind.adx.toFixed(0)} — нет направления`);
  }
  if (htf === "neutral") {
    lowScore += 1;
    lowSignals.push("HTF neutral");
  }
  if (volDaily < 3) {
    lowScore += 0.5;
    lowSignals.push("Низкая волатильность");
  }
  candidates.push({ regime: "Low Conviction", score: lowScore, signals: lowSignals, bias: 0 });

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];
  const runnerUp = candidates[1]?.score ?? 0;
  const margin = winner.score - runnerUp;
  const confidence = Math.round(Math.min(95, Math.max(35, 40 + margin * 12 + winner.score * 5)));

  return {
    regime: winner.regime,
    confidence,
    score: winner.bias,
    signals: winner.signals.slice(0, 5),
  };
}

/** HTF conflict + Low Conviction caps applied after base detection */
export function applyRegimeGuards(
  regime: MarketRegime,
  snapshot: AnalysisSnapshot
): MarketRegime {
  const htf = getHigherTimeframeBias(snapshot);
  let htfConflict = false;
  let confidence = regime.confidence;
  let suppressTrade = false;
  let confidenceCap: ConfidenceLevel | undefined;

  if (
    (regime.regime === "Strong Bull" && htf === "bearish") ||
    (regime.regime === "Strong Bear" && htf === "bullish")
  ) {
    htfConflict = true;
    confidence = Math.max(25, confidence - 25);
    confidenceCap = "Low";
  }

  if (regime.regime === "Low Conviction" && confidence >= 65) {
    confidenceCap = "Low";
    suppressTrade = true;
    confidence = Math.min(confidence, 45);
  }

  if (regime.regime === "Strong Bull" || regime.regime === "Strong Bear") {
    if (!htfConflict) confidenceCap = confidence >= 70 ? "High" : "Medium";
  }

  return {
    ...regime,
    confidence,
    htfConflict,
    confidenceCap,
    suppressTrade,
    signals: htfConflict
      ? [...regime.signals, "Regime конфликтует с HTF bias — снижена уверенность"]
      : regime.signals,
  };
}

export function detectMarketRegimeWithGuards(
  ctx: AnalysisContext,
  snapshot: AnalysisSnapshot
): MarketRegime {
  return applyRegimeGuards(detectMarketRegime(ctx, snapshot), snapshot);
}

/** Numeric encoding for ML (−1…1 per regime family) */
export function regimeToFeature(regime: MarketRegime): number {
  switch (regime.regime) {
    case "Strong Bull":
      return 0.85 * (regime.confidence / 100);
    case "Strong Bear":
      return -0.85 * (regime.confidence / 100);
    case "Mean-Reversion":
    case "Breakout":
      return regime.score;
    case "Low Conviction":
    default:
      return 0;
  }
}
