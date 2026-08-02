/**
 * Production prediction monitoring — live forecasts, outcomes, drift detection.
 */

import fs from "fs/promises";
import path from "path";
import {
  evaluatePredictionAccuracyFromPrices,
  getCandleIntervalForTimeframe,
  getTimeframeDurationMs,
} from "@/lib/accuracy";
import {
  getRegimeStats,
  loadRegimePerformance,
  saveRegimePerformance,
} from "@/lib/backtesting/performance-store";
import type { RegimePerformanceStats } from "@/lib/backtesting/types";
import { getCached, setCached } from "@/lib/cache";
import { resolvePriceForecast } from "@/lib/price-forecast";
import type {
  AccuracyTimePoint,
  DriftAlert,
  EquityPoint,
  ModelConfidenceSummary,
  MonitoredPrediction,
  MonitorStore,
  PerformanceSnapshot,
  PredictionOutcome,
  RollingWindowMetrics,
  SegmentMetrics,
} from "@/lib/monitoring/types";
import { fetchCandlesInRange, fetchCurrentPrice } from "@/services/binance";
import type { MarketRegimeType, PredictionResult } from "@/types";

const MONITOR_DIR = path.join(process.cwd(), ".cache", "prediction-monitor");
const STORE_PATH = path.join(MONITOR_DIR, "store.json");
const SNAPSHOT_CACHE_KEY = "monitoring-snapshot";
const SNAPSHOT_TTL_MS = 5 * 60_000;
const MAX_RECORDS = 2500;

export const DRIFT_DROP_THRESHOLD = 0.08;
export const DRIFT_RECENT_DAYS = 14;
export const DRIFT_BASELINE_DAYS = 60;
export const DRIFT_MIN_SAMPLES = 8;
const ACCURACY_SCORE_THRESHOLD = 72;

const ROLLING_WINDOWS = [30, 90, 180] as const;

export async function recordLivePrediction(
  id: string,
  prediction: PredictionResult
): Promise<void> {
  const store = await loadStore();
  const regime = prediction.analysis?.marketRegime?.regime;

  const record: MonitoredPrediction = {
    id,
    recordedAt: prediction.createdAt ?? new Date().toISOString(),
    symbol: prediction.symbol,
    market: prediction.market,
    timeframe: prediction.timeframe,
    direction: prediction.direction,
    probability: prediction.probability,
    confidence: prediction.confidence,
    priceAtPrediction: prediction.priceAtPrediction,
    regime,
    ensembleScore: prediction.ensembleScore,
    metaTrustScore: prediction.metaTrustScore,
    features: prediction.mlFeatures,
  };

  store.records = store.records.filter((r) => r.id !== id);
  store.records.unshift(record);
  if (store.records.length > MAX_RECORDS) {
    store.records = store.records.slice(0, MAX_RECORDS);
  }
  store.updatedAt = new Date().toISOString();
  await saveStore(store);
  await fs
    .unlink(path.join(process.cwd(), ".cache", `${SNAPSHOT_CACHE_KEY}.json`))
    .catch(() => undefined);
}

async function loadStore(): Promise<MonitorStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    return JSON.parse(raw) as MonitorStore;
  } catch {
    return { updatedAt: new Date(0).toISOString(), records: [] };
  }
}

async function saveStore(store: MonitorStore): Promise<void> {
  await fs.mkdir(MONITOR_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

async function resolveOutcome(record: MonitoredPrediction): Promise<PredictionOutcome> {
  const forecast = resolvePriceForecast({
    direction: record.direction,
    priceAtPrediction: record.priceAtPrediction,
    priceRange: {
      low: record.priceAtPrediction * 0.98,
      high: record.priceAtPrediction * 1.02,
    },
  });

  let actualPrice = await fetchCurrentPrice(record.symbol, record.market);
  let candles: Awaited<ReturnType<typeof fetchCandlesInRange>> = [];

  const createdAt = record.recordedAt;
  const start = new Date(createdAt).getTime();
  const durationMs = getTimeframeDurationMs(record.timeframe);
  const end = Math.min(start + durationMs, Date.now());
  const completed = Date.now() - start >= durationMs;

  if (completed) {
    try {
      const interval = getCandleIntervalForTimeframe(record.timeframe);
      candles = await fetchCandlesInRange(
        record.symbol,
        interval,
        record.market,
        start,
        end
      );
      if (candles.length > 0) {
        actualPrice = candles[candles.length - 1].close;
      }
    } catch {
      // keep current price
    }
  }

  const accuracy = evaluatePredictionAccuracyFromPrices(
    {
      direction: record.direction,
      priceAtPrediction: record.priceAtPrediction,
      timeframe: record.timeframe,
      createdAt,
      priceForecast: forecast,
    },
    actualPrice,
    candles
  );

  return {
    evaluatedAt: new Date().toISOString(),
    actualPrice,
    score: accuracy.score,
    isCorrect: accuracy.isCorrect,
    label: accuracy.label,
    percentChange: accuracy.percentChange,
    timeframePhase: accuracy.timeframePhase,
    priceErrorPct: accuracy.priceErrorPct,
  };
}

/** Refresh pending / stale outcomes (rate-limited per call) */
export async function refreshOutcomes(maxUpdates = 40): Promise<number> {
  const store = await loadStore();
  let updated = 0;

  for (const record of store.records) {
    if (updated >= maxUpdates) break;

    const needsUpdate =
      !record.outcome ||
      record.outcome.timeframePhase === "in_progress" ||
      isOutcomeStale(record);

    if (!needsUpdate) continue;

    try {
      record.outcome = await resolveOutcome(record);
      updated++;
    } catch {
      // skip single failure
    }
  }

  if (updated > 0) {
    store.updatedAt = new Date().toISOString();
    await saveStore(store);
    await fs.unlink(path.join(process.cwd(), ".cache", `${SNAPSHOT_CACHE_KEY}.json`)).catch(() => undefined);
  }

  return updated;
}

function isOutcomeStale(record: MonitoredPrediction): boolean {
  if (!record.outcome) return true;
  const elapsed = Date.now() - new Date(record.outcome.evaluatedAt).getTime();
  if (record.outcome.timeframePhase === "in_progress") return elapsed > 15 * 60_000;
  return elapsed > 6 * 60 * 60_000;
}

function isAccurate(outcome: PredictionOutcome): boolean {
  return outcome.timeframePhase === "completed" && outcome.score >= ACCURACY_SCORE_THRESHOLD;
}

function filterByWindow(records: MonitoredPrediction[], days: number): MonitoredPrediction[] {
  const cutoff = Date.now() - days * 24 * 60 * 60_000;
  return records.filter((r) => new Date(r.recordedAt).getTime() >= cutoff);
}

function computeWindowMetrics(records: MonitoredPrediction[], windowDays: number): RollingWindowMetrics {
  const windowed = filterByWindow(records, windowDays);
  const completed = windowed.filter((r) => r.outcome?.timeframePhase === "completed");
  const inProgress = windowed.filter((r) => r.outcome?.timeframePhase === "in_progress");
  const accurate = completed.filter((r) => r.outcome && isAccurate(r.outcome));
  const wins = completed.filter((r) => r.outcome?.isCorrect === true);

  return {
    windowDays,
    total: windowed.length,
    completed: completed.length,
    inProgress: inProgress.length,
    accuracyRate: completed.length ? accurate.length / completed.length : 0,
    winRate: completed.length ? wins.length / completed.length : 0,
    avgScore:
      completed.length
        ? completed.reduce((s, r) => s + (r.outcome?.score ?? 0), 0) / completed.length
        : 0,
    avgPriceErrorPct:
      completed.length
        ? completed.reduce((s, r) => s + (r.outcome?.priceErrorPct ?? 0), 0) / completed.length
        : 0,
  };
}

function computeSegmentMetrics(
  records: MonitoredPrediction[],
  pickKey: (r: MonitoredPrediction) => string,
  pickLabel: (key: string) => string
): SegmentMetrics[] {
  const groups = new Map<string, MonitoredPrediction[]>();

  for (const r of records) {
    if (r.outcome?.timeframePhase !== "completed") continue;
    const key = pickKey(r);
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([key, list]) => {
      const accurate = list.filter((r) => r.outcome && isAccurate(r.outcome));
      return {
        key,
        label: pickLabel(key),
        completed: list.length,
        accuracyRate: list.length ? accurate.length / list.length : 0,
        avgScore: list.reduce((s, r) => s + (r.outcome?.score ?? 0), 0) / list.length,
      };
    })
    .sort((a, b) => b.completed - a.completed);
}

function computeAccuracyOverTime(records: MonitoredPrediction[]): AccuracyTimePoint[] {
  const buckets = new Map<string, MonitoredPrediction[]>();

  for (const r of records) {
    if (r.outcome?.timeframePhase !== "completed") continue;
    const d = new Date(r.recordedAt);
    const key = d.toISOString().slice(0, 10);
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-90)
    .map(([date, list]) => {
      const accurate = list.filter((r) => r.outcome && isAccurate(r.outcome));
      return {
        date,
        completed: list.length,
        accuracyRate: list.length ? accurate.length / list.length : 0,
        avgScore: list.reduce((s, r) => s + (r.outcome?.score ?? 0), 0) / list.length,
      };
    });
}

function computeEquityCurve(records: MonitoredPrediction[]): EquityPoint[] {
  const completed = records
    .filter((r) => r.outcome?.timeframePhase === "completed")
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  let cum = 0;
  const points: EquityPoint[] = [{ timestamp: 0, cumulativeReturnPct: 0 }];

  for (const r of completed) {
    const move = r.outcome?.percentChange ?? 0;
    let ret = 0;
    if (r.direction === "LONG") ret = move;
    else if (r.direction === "SHORT") ret = -move;
    else ret = Math.abs(move) < 0.2 ? move * 0.25 : 0;

    cum += ret;
    points.push({
      timestamp: new Date(r.recordedAt).getTime(),
      cumulativeReturnPct: Math.round(cum * 100) / 100,
    });
  }

  return points;
}

function segmentAccuracy(
  records: MonitoredPrediction[],
  pickKey: (r: MonitoredPrediction) => string,
  key: string
): { accuracy: number; count: number } {
  const filtered = records.filter(
    (r) => r.outcome?.timeframePhase === "completed" && pickKey(r) === key
  );
  if (!filtered.length) return { accuracy: 0, count: 0 };
  const accurate = filtered.filter((r) => r.outcome && isAccurate(r.outcome));
  return { accuracy: accurate.length / filtered.length, count: filtered.length };
}

export function detectConceptDrift(records: MonitoredPrediction[]): DriftAlert[] {
  const alerts: DriftAlert[] = [];
  const now = Date.now();
  const recentCutoff = now - DRIFT_RECENT_DAYS * 24 * 60 * 60_000;
  const baselineStart = now - (DRIFT_RECENT_DAYS + DRIFT_BASELINE_DAYS) * 24 * 60 * 60_000;
  const baselineEnd = recentCutoff;

  const recent = records.filter((r) => new Date(r.recordedAt).getTime() >= recentCutoff);
  const baseline = records.filter((r) => {
    const t = new Date(r.recordedAt).getTime();
    return t >= baselineStart && t < baselineEnd;
  });

  const check = (
    dimension: DriftAlert["dimension"],
    keys: string[],
    pickKey: (r: MonitoredPrediction) => string,
    labelFn: (k: string) => string
  ) => {
    for (const key of keys) {
      const base = segmentAccuracy(baseline, pickKey, key);
      const rec = segmentAccuracy(recent, pickKey, key);
      if (base.count < DRIFT_MIN_SAMPLES || rec.count < DRIFT_MIN_SAMPLES) continue;

      const drop = base.accuracy - rec.accuracy;
      if (drop >= DRIFT_DROP_THRESHOLD) {
        alerts.push({
          dimension,
          key,
          label: labelFn(key),
          baselineAccuracy: Math.round(base.accuracy * 1000) / 1000,
          recentAccuracy: Math.round(rec.accuracy * 1000) / 1000,
          dropPct: Math.round(drop * 1000) / 1000,
          baselineSamples: base.count,
          recentSamples: rec.count,
          severity: drop >= DRIFT_DROP_THRESHOLD * 1.5 ? "critical" : "warning",
        });
      }
    }
  };

  const regimes = [...new Set(records.map((r) => r.regime).filter(Boolean))] as MarketRegimeType[];
  check("regime", regimes, (r) => r.regime ?? "Unknown", (k) => k);

  const symbols = [...new Set(records.map((r) => r.symbol))].slice(0, 12);
  check("symbol", symbols, (r) => r.symbol, (k) => k);

  const timeframes = [...new Set(records.map((r) => r.timeframe))];
  check("timeframe", timeframes, (r) => r.timeframe, (k) => k);

  const baseOverall = segmentAccuracy(baseline, () => "all", "all");
  const recOverall = segmentAccuracy(recent, () => "all", "all");
  if (
    baseOverall.count >= DRIFT_MIN_SAMPLES &&
    recOverall.count >= DRIFT_MIN_SAMPLES &&
    baseOverall.accuracy - recOverall.accuracy >= DRIFT_DROP_THRESHOLD
  ) {
    alerts.push({
      dimension: "overall",
      key: "all",
      label: "Overall",
      baselineAccuracy: baseOverall.accuracy,
      recentAccuracy: recOverall.accuracy,
      dropPct: baseOverall.accuracy - recOverall.accuracy,
      baselineSamples: baseOverall.count,
      recentSamples: recOverall.count,
      severity:
        baseOverall.accuracy - recOverall.accuracy >= DRIFT_DROP_THRESHOLD * 1.5
          ? "critical"
          : "warning",
    });
  }

  return alerts.sort((a, b) => b.dropPct - a.dropPct);
}

export function buildModelConfidence(
  windows: RollingWindowMetrics[],
  driftAlerts: DriftAlert[]
): ModelConfidenceSummary {
  const w30 = windows.find((w) => w.windowDays === 30) ?? windows[0];
  const accuracy = w30?.accuracyRate ?? 0;
  const samples = w30?.completed ?? 0;
  const driftAlert = driftAlerts.some((a) => a.severity === "critical" || a.dropPct >= DRIFT_DROP_THRESHOLD);

  let score = Math.round(accuracy * 100);
  if (driftAlert) score = Math.max(0, score - 15);
  if (samples < 10) score = Math.min(score, 55);
  if (samples < 5) score = Math.min(score, 45);

  const label: ModelConfidenceSummary["label"] =
    score >= 70 ? "High" : score >= 50 ? "Medium" : "Low";

  return {
    score,
    label,
    rollingAccuracy30d: Math.round(accuracy * 1000) / 1000,
    sampleCount: samples,
    driftAlert,
    driftCount: driftAlerts.length,
  };
}

export async function syncRegimePerformanceFromLive(
  records?: MonitoredPrediction[]
): Promise<RegimePerformanceStats[]> {
  const store = records ?? (await loadStore()).records;
  const completed = store.filter((r) => r.outcome?.timeframePhase === "completed" && r.regime);

  const byRegime = new Map<MarketRegimeType, { trades: number; wins: number; returnSum: number }>();

  for (const r of completed) {
    const regime = r.regime!;
    const bucket = byRegime.get(regime) ?? { trades: 0, wins: 0, returnSum: 0 };
    bucket.trades++;
    if (r.outcome && isAccurate(r.outcome)) bucket.wins++;
    bucket.returnSum += r.outcome?.percentChange ?? 0;
    byRegime.set(regime, bucket);
  }

  const existing = await loadRegimePerformance();
  const merged: RegimePerformanceStats[] = existing.byRegime.map((base) => {
    const live = byRegime.get(base.regime);
    if (!live || live.trades === 0) return base;

    const liveWinRate = live.wins / live.trades;
    const totalTrades = base.trades + live.trades;
    const blendedWinRate =
      totalTrades > 0
        ? (base.winRate * base.trades + liveWinRate * live.trades) / totalTrades
        : liveWinRate;
    const blendedReturn =
      totalTrades > 0
        ? (base.avgReturnPct * base.trades + live.returnSum / live.trades) / totalTrades
        : live.returnSum / live.trades;

    return {
      ...base,
      trades: totalTrades,
      winRate: Math.round(blendedWinRate * 1000) / 1000,
      avgReturnPct: Math.round(blendedReturn * 100) / 100,
    };
  });

  for (const [regime, live] of byRegime) {
    if (merged.some((m) => m.regime === regime)) continue;
    const prior = getRegimeStats(existing, regime);
    merged.push({
      regime,
      trades: live.trades,
      winRate: live.wins / live.trades,
      avgReturnPct: live.returnSum / live.trades,
      llmWinRate: prior.llmWinRate,
      mlWinRate: prior.mlWinRate,
      rulesWinRate: prior.rulesWinRate,
    });
  }

  await saveRegimePerformance(merged);
  return merged;
}

export async function getPerformanceSnapshot(options?: {
  refresh?: boolean;
  syncRegime?: boolean;
}): Promise<PerformanceSnapshot> {
  if (!options?.refresh) {
    const cached = await getCached<PerformanceSnapshot>(SNAPSHOT_CACHE_KEY);
    if (cached) return cached;
  }

  if (options?.refresh) {
    await refreshOutcomes(50);
  }

  const store = await loadStore();
  const windows = ROLLING_WINDOWS.map((d) => computeWindowMetrics(store.records, d));
  const completed180 = filterByWindow(store.records, 180).filter(
    (r) => r.outcome?.timeframePhase === "completed"
  );
  const driftAlerts = detectConceptDrift(store.records);

  if (options?.syncRegime !== false && completed180.length >= 5) {
    await syncRegimePerformanceFromLive(store.records).catch(() => undefined);
  }

  const snapshot: PerformanceSnapshot = {
    generatedAt: new Date().toISOString(),
    windows,
    byRegime: computeSegmentMetrics(completed180, (r) => r.regime ?? "Unknown", (k) => k),
    bySymbol: computeSegmentMetrics(completed180, (r) => r.symbol, (k) => k),
    byTimeframe: computeSegmentMetrics(completed180, (r) => r.timeframe, (k) => k),
    accuracyOverTime: computeAccuracyOverTime(completed180),
    equityCurve: computeEquityCurve(completed180),
    modelConfidence: buildModelConfidence(windows, driftAlerts),
  };

  await setCached(SNAPSHOT_CACHE_KEY, snapshot, SNAPSHOT_TTL_MS);
  return snapshot;
}

export async function getDriftReport(): Promise<{
  generatedAt: string;
  alerts: DriftAlert[];
  threshold: number;
  modelConfidence: ModelConfidenceSummary;
}> {
  const store = await loadStore();
  const alerts = detectConceptDrift(store.records);
  const windows = ROLLING_WINDOWS.map((d) => computeWindowMetrics(store.records, d));

  return {
    generatedAt: new Date().toISOString(),
    alerts,
    threshold: DRIFT_DROP_THRESHOLD,
    modelConfidence: buildModelConfidence(windows, alerts),
  };
}

export async function getModelConfidence(): Promise<ModelConfidenceSummary> {
  const snapshot = await getPerformanceSnapshot({ refresh: false, syncRegime: false });
  return snapshot.modelConfidence;
}

export async function getLiveRegimePerformance(): Promise<{
  updatedAt: string;
  live: SegmentMetrics[];
  merged: RegimePerformanceStats[];
}> {
  const store = await loadStore();
  const completed = filterByWindow(store.records, 180).filter(
    (r) => r.outcome?.timeframePhase === "completed"
  );
  const live = computeSegmentMetrics(completed, (r) => r.regime ?? "Unknown", (k) => k);
  const merged = await syncRegimePerformanceFromLive(store.records);
  const existing = await loadRegimePerformance();

  return {
    updatedAt: existing.updatedAt,
    live,
    merged,
  };
}

export async function getMonitorRecords(): Promise<MonitoredPrediction[]> {
  const store = await loadStore();
  return store.records;
}
