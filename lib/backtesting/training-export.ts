/**
 * ML training export from backtest observations.
 */

import fs from "fs/promises";
import path from "path";
import type { EnsembleBreakdown, MarketRegime, PredictionDirection } from "@/types";

export const TRAINING_JSONL_PATH = path.join(process.cwd(), ".cache", "backtest-training.jsonl");

export interface TrainingOutcome {
  direction: PredictionDirection;
  priceMovePct: number;
  entryPrice: number;
  exitPrice: number;
}

/** Training row — label: 1=bullish move, -1=bearish, 0=neutral (skipped) */
export interface BacktestTrainingRecord {
  timestamp: number;
  symbol: string;
  timeframe: string;
  features: Record<string, number>;
  regime: MarketRegime;
  ensembleBreakdown: EnsembleBreakdown;
  outcome: TrainingOutcome;
  label: number;
}

export function outcomeToLabel(priceMovePct: number, threshold = 0.15): number {
  if (priceMovePct > threshold) return 1;
  if (priceMovePct < -threshold) return -1;
  return 0;
}

export function buildTrainingRecord(params: {
  timestamp: number;
  symbol: string;
  timeframe: string;
  features: Record<string, number>;
  regime: MarketRegime;
  ensembleBreakdown: EnsembleBreakdown;
  entryPrice: number;
  exitPrice: number;
}): BacktestTrainingRecord {
  const priceMovePct =
    params.entryPrice > 0
      ? ((params.exitPrice - params.entryPrice) / params.entryPrice) * 100
      : 0;

  let direction: PredictionDirection = "SIDEWAYS";
  if (priceMovePct > 0.15) direction = "LONG";
  else if (priceMovePct < -0.15) direction = "SHORT";

  return {
    timestamp: params.timestamp,
    symbol: params.symbol,
    timeframe: params.timeframe,
    features: params.features,
    regime: params.regime,
    ensembleBreakdown: params.ensembleBreakdown,
    outcome: {
      direction,
      priceMovePct: Math.round(priceMovePct * 10000) / 10000,
      entryPrice: params.entryPrice,
      exitPrice: params.exitPrice,
    },
    label: outcomeToLabel(priceMovePct),
  };
}

/** Write JSONL (one JSON object per line)  */
export async function writeTrainingJsonl(
  records: BacktestTrainingRecord[],
  filePath: string = TRAINING_JSONL_PATH
): Promise<{ path: string; count: number; labeledCount: number }> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lines = records.map((r) => JSON.stringify(r));
  await fs.writeFile(filePath, lines.join("\n") + (lines.length ? "\n" : ""), "utf-8");
  const labeledCount = records.filter((r) => r.label !== 0).length;
  return { path: filePath, count: records.length, labeledCount };
}

export async function writeTrainingArrayForMl(
  records: BacktestTrainingRecord[],
  filePath: string = path.join(process.cwd(), ".cache", "backtest-training-array.json")
): Promise<string> {
  const compact = records
    .filter((r) => r.label !== 0)
    .map((r) => ({ features: r.features, label: r.label }));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(compact, null, 2), "utf-8");
  return filePath;
}
