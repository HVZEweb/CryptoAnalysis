/**
 * Meta-learner + dynamic ensemble weights calibrated from backtest regime stats.
 */

import { getRegimeStats, loadRegimePerformance } from "@/lib/backtesting/performance-store";
import type { RegimePerformanceStats } from "@/lib/backtesting/types";
import type {
  EnsembleBreakdown,
  MarketRegime,
  MarketRegimeType,
  PredictionDirection,
} from "@/types";

export const DEFAULT_ENSEMBLE_WEIGHTS = { llm: 0.5, ml: 0.35, rules: 0.15 } as const;

export type EnsembleWeights = { llm: number; ml: number; rules: number };

export function getEnsembleScoreThreshold(): number {
  const raw = process.env.ENSEMBLE_SCORE_THRESHOLD?.trim();
  const n = raw ? parseFloat(raw) : 0.12;
  return Number.isFinite(n) ? Math.max(0.05, Math.min(0.35, n)) : 0.12;
}

export interface MetaLearnerResult {
  trustScore: number;
  lowConfidence: boolean;
  suppressPrediction: boolean;
  reason: string;
}

const REGIME_WEIGHT_PROFILES: Record<MarketRegimeType, EnsembleWeights> = {
  "Strong Bull": { llm: 0.4, ml: 0.35, rules: 0.25 },
  "Strong Bear": { llm: 0.4, ml: 0.35, rules: 0.25 },
  "Mean-Reversion": { llm: 0.45, ml: 0.3, rules: 0.25 },
  Breakout: { llm: 0.35, ml: 0.45, rules: 0.2 },
  "Low Conviction": { llm: 0.55, ml: 0.2, rules: 0.25 },
};

function normalizeWeights(w: EnsembleWeights): EnsembleWeights {
  const sum = w.llm + w.ml + w.rules;
  if (sum <= 0) return { ...DEFAULT_ENSEMBLE_WEIGHTS };
  return { llm: w.llm / sum, ml: w.ml / sum, rules: w.rules / sum };
}

export function resolveDynamicWeights(
  regime: MarketRegime | undefined,
  agreement: EnsembleBreakdown["agreement"],
  stats?: RegimePerformanceStats
): EnsembleWeights {
  const base = regime
    ? { ...REGIME_WEIGHT_PROFILES[regime.regime] }
    : { ...DEFAULT_ENSEMBLE_WEIGHTS };

  if (stats && stats.trades >= 10) {
    const total = stats.llmWinRate + stats.mlWinRate + stats.rulesWinRate || 1;
    base.llm = base.llm * 0.6 + (stats.llmWinRate / total) * 0.4;
    base.ml = base.ml * 0.6 + (stats.mlWinRate / total) * 0.4;
    base.rules = base.rules * 0.6 + (stats.rulesWinRate / total) * 0.4;
  }

  if (agreement === "full") {
    base.ml *= 1.08;
    base.llm *= 1.05;
  } else if (agreement === "divergent") {
    base.rules *= 1.2;
    base.llm *= 0.92;
    base.ml *= 0.92;
  }

  if (regime?.regime === "Low Conviction") {
    base.rules *= 1.15;
    base.ml *= 0.85;
  }

  return normalizeWeights(base);
}

export async function resolveDynamicWeightsFromStore(
  regime: MarketRegime | undefined,
  agreement: EnsembleBreakdown["agreement"]
): Promise<EnsembleWeights> {
  if (process.env.ENSEMBLE_DYNAMIC_WEIGHTS === "false") {
    return { ...DEFAULT_ENSEMBLE_WEIGHTS };
  }
  const store = await loadRegimePerformance();
  const stats = regime ? getRegimeStats(store, regime.regime) : undefined;
  return resolveDynamicWeights(regime, agreement, stats);
}

export function evaluateMetaLearner(
  breakdown: EnsembleBreakdown,
  regime?: MarketRegime
): MetaLearnerResult {
  const threshold = getEnsembleScoreThreshold();
  const score = Math.abs(breakdown.ensembleScore);

  let trust = 50;
  if (breakdown.agreement === "full") trust += 25;
  else if (breakdown.agreement === "partial") trust += 10;
  else trust -= 15;

  if (breakdown.mlAvailable) trust += 10;
  else trust -= 10;

  if (
    breakdown.llm.direction !== breakdown.finalDirection &&
    breakdown.finalDirection !== "SIDEWAYS"
  ) {
    trust -= breakdown.llm.direction === "SIDEWAYS" ? 12 : 20;
  }

  if (regime) {
    trust += (regime.confidence - 50) * 0.3;
    if (regime.regime === "Low Conviction") trust -= 20;
    if (regime.regime === "Strong Bull" || regime.regime === "Strong Bear") trust += 8;
  }

  trust = Math.round(Math.min(95, Math.max(10, trust)));
  const lowConfidence = score < threshold || trust < 45;
  const suppressPrediction =
    regime?.regime === "Low Conviction" &&
    regime.confidence >= 70 &&
    score < threshold * 1.2;

  let reason = lowConfidence
    ? `|ensembleScore| ${score.toFixed(3)} < threshold ${threshold}`
    : "Ensemble signal within confidence band";

  if (suppressPrediction) {
    reason = "Low Conviction regime + weak ensemble — prediction suppressed";
  }

  return { trustScore: trust, lowConfidence, suppressPrediction, reason };
}

export function isComponentCorrect(
  direction: PredictionDirection,
  entry: number,
  exit: number,
  minMovePct = 0.15
): boolean {
  const ret = ((exit - entry) / entry) * 100;
  if (direction === "LONG") return ret > minMovePct;
  if (direction === "SHORT") return ret < -minMovePct;
  return Math.abs(ret) < minMovePct * 0.6;
}
