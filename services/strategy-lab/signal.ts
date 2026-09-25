/**
 * Live side of the strategy lab: turns the model's current P(up) into a trade only when the model's
 * setup made money after fees on history it was not tuned on.
 */

import type { StrategySignal } from "@/types";
import type { PricePrediction } from "@/services/predictor";

export function strategySignal(run: PricePrediction | null, price: number): StrategySignal {
  const report = run?.model.strategy;
  if (!run || !report) {
    return {
      status: "untested",
      reason: "стратегия для этого таймфрейма ещё не проверялась на истории — нужно переобучить модели",
    };
  }
  const best = report.best;
  if (!report.profitable || !best) return { status: "no_setup", reason: report.reason };

  const { setup, holdout } = best;
  const base: StrategySignal = {
    status: "no_setup",
    reason: "",
    setup: { slAtr: setup.slAtr, rr: setup.rr, horizonBars: setup.horizon, interval: run.model.interval, minEdge: setup.minEdge },
    holdout: {
      trades: holdout.trades,
      winRate: holdout.winRate,
      avgNetBp: holdout.avgNetBp,
      avgNetBpTaker: holdout.avgNetBpTaker,
      tStat: holdout.tStat,
      tradesPerWeek: holdout.tradesPerWeek,
    },
  };
  const edge = run.probabilityUp - 0.5;
  if (Math.abs(edge) < setup.minEdge) {
    return {
      ...base,
      status: "weak_signal",
      reason: `сигнал слабее проверенного порога: ${(Math.abs(edge) * 100).toFixed(1)} п.п. от 50% при нужных ${(setup.minEdge * 100).toFixed(0)}`,
    };
  }
  if (!(run.atr > 0) || !(price > 0)) return { ...base, reason: "нет данных о волатильности для уровней" };

  const side = edge > 0 ? 1 : -1;
  const slDist = run.atr * setup.slAtr;
  return {
    ...base,
    status: "trade",
    side: side > 0 ? "LONG" : "SHORT",
    reason: report.reason,
    levels: { sl: price - side * slDist, tp: price + side * slDist * setup.rr },
  };
}
