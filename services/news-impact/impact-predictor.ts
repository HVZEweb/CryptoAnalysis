import type { PredictionDirection } from "@/types";
import {
  biasAlignmentBoost,
  getActivePredictionForCoin,
  resolveImpactOnExisting,
  type ActivePredictionContext,
} from "@/services/news-impact/prediction-link";
import { resolvePrimaryCoin, sectorImpactBoost } from "@/services/news-impact/coin-resolver";
import { blendImpactScore, scoreImpactMl } from "@/services/news-impact/impact-ml";
import {
  fetchCoinMarketSnapshot,
  onChainAlignsWithDirection,
  volatilityMoveMultiplier,
  type CoinMarketSnapshot,
} from "@/services/news-impact/market-snapshot";
import {
  contextAlignsWithDirection,
  fetchNewsPriceContext,
  type NewsPriceContext,
} from "@/services/news-impact/news-context";
import type {
  LlmNewsClassification,
  NewsImpactDuration,
  NewsImpactPrediction,
  NewsImpactStrength,
  NewsImpactUrgency,
  NewsRecommendedAction,
  RawNewsSignal,
  RuleAnalysisResult,
} from "@/services/news-impact/types";

const HOLD_TIME: Record<NewsImpactDuration, string> = {
  "5min": "5-15 min",
  "15min": "15-45 min",
  "1h": "45-90 min",
  ">1h": "1-4 hours",
};

const MOVE_PCT: Record<NewsImpactStrength, [number, number]> = {
  Low: [0.2, 0.8],
  Medium: [0.5, 1.5],
  High: [1.2, 3.0],
  Extreme: [2.5, 5.5],
};

const CATEGORY_MOVE_MULT: Record<string, number> = {
  security: 1.35,
  stablecoin: 1.3,
  insolvency: 1.25,
  derivatives: 1.2,
  exchange_listing: 1.05,
  regulation: 1.1,
  macro: 1.15,
  onchain_flow: 0.9,
  partnership: 0.85,
  launch: 1.0,
};

const SECONDARY_SCORE_FACTOR = 0.82;

export interface PredictionEnrichment {
  market?: CoinMarketSnapshot | null;
  newsContext?: NewsPriceContext | null;
}

function biasToDirection(bias: string): PredictionDirection {
  if (bias === "Bullish") return "LONG";
  if (bias === "Bearish") return "SHORT";
  return "SIDEWAYS";
}

function mergeStrength(a: NewsImpactStrength, b: NewsImpactStrength): NewsImpactStrength {
  const order: NewsImpactStrength[] = ["Low", "Medium", "High", "Extreme"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))] ?? a;
}

function mergeScore(ruleScore: number, llm?: LlmNewsClassification | null): number {
  if (!llm) return Math.round(ruleScore);
  const weight = Math.min(0.55, (llm.confidence / 100) * 0.55);
  return Math.round(ruleScore * (1 - weight) + llm.impactScore * weight);
}

function resolveUrgency(duration: NewsImpactDuration, strength: NewsImpactStrength): NewsImpactUrgency {
  if (duration === "5min" || strength === "Extreme") return "Immediate";
  if (duration === "15min" || strength === "High") return "Short";
  return "Medium";
}

function resolveRecommendedAction(
  direction: PredictionDirection,
  strength: NewsImpactStrength
): NewsRecommendedAction {
  if (strength === "Low" || direction === "SIDEWAYS") return "Wait";
  if (direction === "LONG") return "Long Futures";
  if (direction === "SHORT") return "Short";
  return "Wait";
}

function estimateMovePct(
  strength: NewsImpactStrength,
  impactScore: number,
  category: string,
  enrichment?: PredictionEnrichment
): number {
  const [lo, hi] = MOVE_PCT[strength];
  const t = Math.min(1, impactScore / 100);
  let move = lo + (hi - lo) * t;

  const catMult = CATEGORY_MOVE_MULT[category] ?? 1;
  move *= catMult;

  if (enrichment?.market) {
    move *= volatilityMoveMultiplier(enrichment.market);
    if (enrichment.market.regimeProxy === "volatile") move *= 1.12;
  }

  if (enrichment?.newsContext && enrichment.newsContext.volatility30mPct >= 0.4) {
    move *= 1.08;
  }

  return Math.round(move * 100) / 100;
}

export interface BuildImpactOptions {
  activePrediction?: ActivePredictionContext | null;
  llmNote?: string;
  coinOverride?: string;
  scoreFactor?: number;
  isSecondary?: boolean;
  enrichment?: PredictionEnrichment;
}

export function buildImpactPrediction(
  signal: RawNewsSignal,
  rules: RuleAnalysisResult,
  llm?: LlmNewsClassification | null,
  options: BuildImpactOptions = {}
): NewsImpactPrediction | null {
  if (rules.filtered) return null;

  const coinCandidates = options.coinOverride
    ? [options.coinOverride]
    : llm?.coin
      ? [llm.coin, ...rules.coins]
      : rules.coins;

  const coin = resolvePrimaryCoin(coinCandidates);
  if (!coin || coin === "UNKNOWN") return null;

  const bias = llm?.bias ?? rules.bias;
  const strength = mergeStrength(rules.strength, llm?.strength ?? rules.strength);
  const duration = llm?.duration ?? rules.duration;
  let impactScore = mergeScore(rules.impactScore, llm);
  if (options.scoreFactor) impactScore = Math.round(impactScore * options.scoreFactor);

  const direction = biasToDirection(bias);
  const active = options.activePrediction ?? null;
  const alignBoost = biasAlignmentBoost(direction, active);
  impactScore = Math.min(100, Math.max(0, impactScore + alignBoost));

  const enrichment = options.enrichment;
  if (enrichment?.newsContext) {
    impactScore = Math.min(
      100,
      Math.max(0, impactScore + contextAlignsWithDirection(enrichment.newsContext, direction))
    );
  }
  if (enrichment?.market) {
    impactScore = Math.min(
      100,
      Math.max(0, impactScore + onChainAlignsWithDirection(enrichment.market, direction))
    );
  }

  const impactOnExisting = resolveImpactOnExisting(direction, active);
  const analysisMethod: NewsImpactPrediction["analysisMethod"] = llm
    ? rules.matchedRules.length
      ? "hybrid"
      : "llm"
    : "rules";

  const ml = scoreImpactMl({
    impactScore,
    significanceScore: signal.significanceScore,
    sourcePriority: signal.sourcePriority ?? 50,
    strength,
    category: rules.category,
    direction,
    analysisMethod,
    llmConfidence: llm?.confidence,
    market: enrichment?.market,
    newsContext: enrichment?.newsContext,
    confirmsPrediction: impactOnExisting === "confirms",
    contradictsPrediction: impactOnExisting === "contradicts",
  });

  impactScore = blendImpactScore(impactScore, ml.mlScore);

  if (!options.isSecondary && rules.affectedCoins?.length) {
    impactScore = Math.min(100, impactScore + sectorImpactBoost(rules.affectedCoins));
  }

  if (impactScore < 45 && strength === "Low") return null;
  if (impactScore < 40 && strength === "Medium" && direction === "SIDEWAYS") return null;

  const reason = (llm?.reason || rules.reason).slice(0, 400);
  const llmNote = llm ? undefined : options.llmNote;

  return {
    coin,
    direction,
    impactScore,
    strength,
    reason: options.isSecondary ? `[secondary] ${reason}` : reason,
    suggestedHoldTime: HOLD_TIME[duration],
    timestamp: new Date().toISOString(),
    source: signal.source,
    sourceUrl: signal.url,
    category: rules.category,
    duration,
    newsId: `${signal.id}:${coin}`,
    analysisMethod,
    urgency: resolveUrgency(duration, strength),
    recommendedAction: resolveRecommendedAction(direction, strength),
    expectedMovePct: estimateMovePct(strength, impactScore, rules.category, enrichment),
    relatedPredictionId: active?.id,
    impactOnExisting,
    llmNote,
    isSecondary: options.isSecondary,
    confidence: ml.confidence,
    mlScore: ml.mlScore,
    newsContext: enrichment?.newsContext?.summary,
    marketContext: enrichment?.market?.summary,
    regimeProxy: enrichment?.market?.regimeProxy,
    affectedCoins: options.isSecondary ? undefined : rules.affectedCoins,
    sectorLabel: options.isSecondary ? undefined : rules.sectorLabel,
    newsTitle: options.isSecondary ? undefined : signal.title,
  };
}

async function loadEnrichment(coin: string): Promise<PredictionEnrichment> {
  const [market, newsContext] = await Promise.all([
    fetchCoinMarketSnapshot(coin).catch(() => null),
    fetchNewsPriceContext(coin).catch(() => null),
  ]);
  return { market, newsContext };
}

/** Build predictions for primary + up to 2 secondary coins */
export async function buildImpactPredictionsWithContext(
  signal: RawNewsSignal,
  rules: RuleAnalysisResult,
  llm?: LlmNewsClassification | null,
  llmNote?: string
): Promise<NewsImpactPrediction[]> {
  const primary = resolvePrimaryCoin(rules.coins);
  if (!primary) return [];

  const predictions: NewsImpactPrediction[] = [];
  const coins = [primary, ...(rules.secondaryCoins ?? []).filter((c) => c !== primary).slice(0, 2)];

  for (let i = 0; i < coins.length; i++) {
    const coin = coins[i];
    const isSecondary = i > 0;
    const [active, enrichment] = await Promise.all([
      getActivePredictionForCoin(coin).catch(() => null),
      loadEnrichment(coin),
    ]);

    const pred = buildImpactPrediction(signal, rules, isSecondary ? null : llm, {
      activePrediction: active,
      llmNote: isSecondary ? undefined : llmNote,
      coinOverride: coin,
      scoreFactor: isSecondary ? SECONDARY_SCORE_FACTOR : undefined,
      isSecondary,
      enrichment,
    });

    if (pred) predictions.push(pred);
  }

  return predictions;
}

/** @deprecated Use buildImpactPredictionsWithContext */
export async function buildImpactPredictionWithContext(
  signal: RawNewsSignal,
  rules: RuleAnalysisResult,
  llm?: LlmNewsClassification | null,
  llmNote?: string
): Promise<NewsImpactPrediction | null> {
  const preds = await buildImpactPredictionsWithContext(signal, rules, llm, llmNote);
  return preds[0] ?? null;
}

export function rankPredictions(predictions: NewsImpactPrediction[]): NewsImpactPrediction[] {
  return [...predictions].sort(
    (a, b) =>
      (a.isSecondary === b.isSecondary ? 0 : a.isSecondary ? 1 : -1) ||
      b.impactScore - a.impactScore ||
      b.confidence - a.confidence ||
      b.timestamp.localeCompare(a.timestamp)
  );
}

export function isHotSignal(signal: NewsImpactPrediction): boolean {
  return (
    !signal.isSecondary &&
    (signal.strength === "High" || signal.strength === "Extreme") &&
    signal.impactScore >= 65
  );
}
