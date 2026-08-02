/**
 * Persist regime-level component performance from backtests for dynamic ensemble weights.
 */

import fs from "fs/promises";
import path from "path";
import { getCached, setCached } from "@/lib/cache";
import type { RegimePerformanceStats } from "@/lib/backtesting/types";
import type { MarketRegimeType } from "@/types";

const STORE_PATH = path.join(process.cwd(), ".cache", "regime-performance.json");
const CACHE_KEY = "regime-performance";
const TTL_MS = 24 * 60 * 60 * 1000;

export interface RegimePerformanceStore {
  updatedAt: string;
  byRegime: RegimePerformanceStats[];
}

const DEFAULT_STATS: RegimePerformanceStats[] = [
  { regime: "Strong Bull", trades: 0, winRate: 0.55, avgReturnPct: 0, llmWinRate: 0.5, mlWinRate: 0.52, rulesWinRate: 0.58 },
  { regime: "Strong Bear", trades: 0, winRate: 0.55, avgReturnPct: 0, llmWinRate: 0.5, mlWinRate: 0.52, rulesWinRate: 0.58 },
  { regime: "Mean-Reversion", trades: 0, winRate: 0.48, avgReturnPct: 0, llmWinRate: 0.45, mlWinRate: 0.5, rulesWinRate: 0.52 },
  { regime: "Breakout", trades: 0, winRate: 0.5, avgReturnPct: 0, llmWinRate: 0.48, mlWinRate: 0.55, rulesWinRate: 0.5 },
  { regime: "Low Conviction", trades: 0, winRate: 0.42, avgReturnPct: 0, llmWinRate: 0.4, mlWinRate: 0.45, rulesWinRate: 0.48 },
];

export async function loadRegimePerformance(): Promise<RegimePerformanceStore> {
  const cached = await getCached<RegimePerformanceStore>(CACHE_KEY);
  if (cached) return cached;

  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as RegimePerformanceStore;
    await setCached(CACHE_KEY, parsed, TTL_MS);
    return parsed;
  } catch {
    return { updatedAt: new Date(0).toISOString(), byRegime: DEFAULT_STATS };
  }
}

export async function saveRegimePerformance(stats: RegimePerformanceStats[]): Promise<void> {
  const store: RegimePerformanceStore = {
    updatedAt: new Date().toISOString(),
    byRegime: stats,
  };
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
  await setCached(CACHE_KEY, store, TTL_MS);
}

export function getRegimeStats(
  store: RegimePerformanceStore,
  regime: MarketRegimeType
): RegimePerformanceStats {
  return (
    store.byRegime.find((r) => r.regime === regime) ??
    DEFAULT_STATS.find((r) => r.regime === regime)!
  );
}
