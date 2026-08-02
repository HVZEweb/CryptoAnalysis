/**
 * Persist backtest run summaries for UI history table.
 */

import fs from "fs/promises";
import path from "path";
import type { BacktestReport } from "@/lib/backtesting/types";

const RUNS_DIR = path.join(process.cwd(), ".cache", "backtest-runs");
const INDEX_PATH = path.join(RUNS_DIR, "index.json");

export interface BacktestRunSummary {
  id: string;
  symbol: string;
  market: string;
  timeframe: string;
  periodDays: number;
  mode: string;
  generatedAt: string;
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
  profitFactor: number;
  maxDrawdownPct: number;
  trainingExported: boolean;
  trainingSamples?: number;
  mlRetrained?: boolean;
}

interface RunsIndex {
  runs: BacktestRunSummary[];
}

export async function saveBacktestRun(
  report: BacktestReport,
  meta: {
    periodDays: number;
    trainingExported?: boolean;
    trainingSamples?: number;
    mlRetrained?: boolean;
  }
): Promise<string> {
  const id = `bt-${Date.now()}`;
  await fs.mkdir(RUNS_DIR, { recursive: true });

  const summary: BacktestRunSummary = {
    id,
    symbol: report.symbol,
    market: report.market,
    timeframe: report.timeframe,
    periodDays: meta.periodDays,
    mode: report.mode,
    generatedAt: report.generatedAt,
    totalTrades: report.metrics.totalTrades,
    winRate: report.metrics.winRate,
    sharpeRatio: report.metrics.sharpeRatio,
    profitFactor: report.metrics.profitFactor,
    maxDrawdownPct: report.metrics.maxDrawdownPct,
    trainingExported: !!meta.trainingExported,
    trainingSamples: meta.trainingSamples,
    mlRetrained: meta.mlRetrained,
  };

  const reportPath = path.join(RUNS_DIR, `${id}.json`);
  await fs.writeFile(
    reportPath,
    JSON.stringify({ ...report, trades: report.trades.slice(-80) }),
    "utf-8"
  );

  let index: RunsIndex = { runs: [] };
  try {
    index = JSON.parse(await fs.readFile(INDEX_PATH, "utf-8")) as RunsIndex;
  } catch {
    // fresh
  }

  index.runs.unshift(summary);
  index.runs = index.runs.slice(0, 30);
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");

  return id;
}

export async function listBacktestRuns(): Promise<BacktestRunSummary[]> {
  try {
    const index = JSON.parse(await fs.readFile(INDEX_PATH, "utf-8")) as RunsIndex;
    return index.runs ?? [];
  } catch {
    return [];
  }
}

export async function loadBacktestRun(id: string): Promise<BacktestReport | null> {
  try {
    const raw = await fs.readFile(path.join(RUNS_DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw) as BacktestReport;
  } catch {
    return null;
  }
}
