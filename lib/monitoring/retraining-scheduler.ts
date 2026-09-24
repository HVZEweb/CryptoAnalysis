/**
 * Scheduled ML retrain — merges backtest + live monitoring data.
 */

import fs from "fs/promises";
import path from "path";
import {
  outcomeToLabel,
  TRAINING_JSONL_PATH,
  writeTrainingArrayForMl,
  type BacktestTrainingRecord,
} from "@/lib/backtesting/training-export";
import {
  detectConceptDrift,
  DRIFT_DROP_THRESHOLD,
  getMonitorRecords,
} from "@/lib/monitoring/prediction-monitor";
import type {
  MonitoredPrediction,
  RetrainDecision,
  RetrainRunRecord,
  RetrainSchedulerState,
} from "@/lib/monitoring/types";
import { runMlRetrain } from "@/services/ml-retrain";

const MONITOR_DIR = path.join(process.cwd(), ".cache", "prediction-monitor");
const STATE_PATH = path.join(MONITOR_DIR, "retrain-state.json");
const MERGED_TRAINING_PATH = path.join(MONITOR_DIR, "merged-training.jsonl");
const MERGED_ARRAY_PATH = path.join(MONITOR_DIR, "merged-training-array.json");

export const DEFAULT_RETRAIN_INTERVAL_DAYS = 7;
export const MIN_TRAIN_SAMPLES = 30;

function getIntervalDays(): number {
  const raw = parseInt(process.env.MONITORING_RETRAIN_INTERVAL_DAYS ?? "", 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_RETRAIN_INTERVAL_DAYS;
}

function getMinSamples(): number {
  const raw = parseInt(process.env.MONITORING_MIN_TRAIN_SAMPLES ?? "", 10);
  return Number.isFinite(raw) && raw >= 10 ? raw : MIN_TRAIN_SAMPLES;
}

async function loadState(): Promise<RetrainSchedulerState> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf-8");
    return JSON.parse(raw) as RetrainSchedulerState;
  } catch {
    return {
      updatedAt: new Date(0).toISOString(),
      history: [],
      intervalDays: getIntervalDays(),
    };
  }
}

async function saveState(state: RetrainSchedulerState): Promise<void> {
  await fs.mkdir(MONITOR_DIR, { recursive: true });
  state.updatedAt = new Date().toISOString();
  state.intervalDays = getIntervalDays();
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

async function loadBacktestRecords(): Promise<BacktestTrainingRecord[]> {
  try {
    const raw = await fs.readFile(TRAINING_JSONL_PATH, "utf-8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as BacktestTrainingRecord);
  } catch {
    return [];
  }
}

function liveToTrainingRecords(records: MonitoredPrediction[]): BacktestTrainingRecord[] {
  const out: BacktestTrainingRecord[] = [];

  for (const r of records) {
    if (!r.features || !r.outcome || r.outcome.timeframePhase !== "completed") continue;

    const move = r.outcome.percentChange;
    const label = outcomeToLabel(move);
    if (label === 0) continue;

    out.push({
      timestamp: new Date(r.recordedAt).getTime(),
      symbol: r.symbol,
      timeframe: r.timeframe,
      features: r.features,
      regime: {
        regime: r.regime ?? "Low Conviction",
        confidence: 50,
        score: 0,
        signals: [],
      },
      ensembleBreakdown: {
        weights: { llm: 0.5, ml: 0.35, rules: 0.15 },
        effectiveWeights: { llm: 0.5, ml: 0.35, rules: 0.15 },
        mlAvailable: true,
        llm: { direction: r.direction, probability: r.probability, score: 0 },
        ml: {
          direction: r.direction,
          probability: r.probability,
          probabilityUp: r.probability,
          probabilityDown: 100 - r.probability,
          model: "live",
          confidence: 50,
          keyFeatures: [],
        },
        rules: [],
        rulesAggregateScore: 0,
        ensembleScore: r.ensembleScore ?? 0,
        agreement: "partial",
        finalDirection: r.direction,
        finalProbability: r.probability,
      },
      outcome: {
        direction: r.direction,
        priceMovePct: move,
        entryPrice: r.priceAtPrediction,
        exitPrice: r.outcome.actualPrice,
      },
      label,
    });
  }

  return out;
}

export async function buildMergedTrainingDataset(): Promise<{
  records: BacktestTrainingRecord[];
  backtestCount: number;
  liveCount: number;
  labeledCount: number;
}> {
  const backtest = await loadBacktestRecords();
  const live = liveToTrainingRecords(await getMonitorRecords());

  const seen = new Set<string>();
  const merged: BacktestTrainingRecord[] = [];

  for (const r of [...backtest, ...live]) {
    const key = `${r.timestamp}:${r.symbol}:${r.timeframe}:${r.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }

  merged.sort((a, b) => b.timestamp - a.timestamp);

  await fs.mkdir(MONITOR_DIR, { recursive: true });
  const lines = merged.map((r) => JSON.stringify(r));
  await fs.writeFile(MERGED_TRAINING_PATH, lines.join("\n") + (lines.length ? "\n" : ""), "utf-8");
  await writeTrainingArrayForMl(merged, MERGED_ARRAY_PATH);

  const labeledCount = merged.filter((r) => r.label !== 0).length;

  return {
    records: merged,
    backtestCount: backtest.filter((r) => r.label !== 0).length,
    liveCount: live.length,
    labeledCount,
  };
}

export async function evaluateRetrainNeed(): Promise<RetrainDecision> {
  const state = await loadState();
  const records = await getMonitorRecords();
  const driftAlerts = detectConceptDrift(records);
  const criticalDrift = driftAlerts.filter((a) => a.dropPct >= DRIFT_DROP_THRESHOLD);

  const lastAt = state.lastRun?.finishedAt ? new Date(state.lastRun.finishedAt).getTime() : null;
  const daysSinceLastRun =
    lastAt != null ? (Date.now() - lastAt) / (24 * 60 * 60_000) : null;
  const intervalDays = getIntervalDays();

  if (criticalDrift.length > 0) {
    return {
      shouldRun: true,
      trigger: "drift",
      reason: `Concept drift: ${criticalDrift.length} alert(s) ≥ ${DRIFT_DROP_THRESHOLD * 100}%`,
      driftAlerts: criticalDrift.length,
      daysSinceLastRun,
    };
  }

  if (daysSinceLastRun === null || daysSinceLastRun >= intervalDays) {
    return {
      shouldRun: true,
      trigger: "scheduled",
      reason:
        daysSinceLastRun === null
          ? "No previous retrain recorded"
          : `Scheduled interval (${intervalDays}d) elapsed`,
      driftAlerts: 0,
      daysSinceLastRun,
    };
  }

  return {
    shouldRun: false,
    reason: `Next scheduled in ${Math.ceil(intervalDays - daysSinceLastRun)}d`,
    driftAlerts: 0,
    daysSinceLastRun,
  };
}

export async function getRetrainStatus(): Promise<RetrainSchedulerState & { decision: RetrainDecision }> {
  const state = await loadState();
  const decision = await evaluateRetrainNeed();
  const intervalDays = getIntervalDays();

  let nextScheduledAt = state.nextScheduledAt;
  if (state.lastRun?.finishedAt) {
    const next = new Date(state.lastRun.finishedAt).getTime() + intervalDays * 24 * 60 * 60_000;
    nextScheduledAt = new Date(next).toISOString();
  }

  return { ...state, intervalDays, nextScheduledAt, decision };
}

export interface RunRetrainOptions {
  force?: boolean;
  trigger?: RetrainRunRecord["trigger"];
}

export async function runScheduledRetrain(
  options: RunRetrainOptions = {}
): Promise<{ run: RetrainRunRecord; decision: RetrainDecision; skipped: boolean }> {
  const decision = await evaluateRetrainNeed();
  const force = options.force === true;
  const trigger = options.trigger ?? (force ? "forced" : decision.trigger);

  if (!force && !decision.shouldRun) {
    return {
      run: {
        id: `skip-${Date.now()}`,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        trigger: "scheduled",
        ok: false,
        samples: 0,
        backtestSamples: 0,
        liveSamples: 0,
        error: decision.reason,
      },
      decision,
      skipped: true,
    };
  }

  const startedAt = new Date().toISOString();
  const id = `retrain-${Date.now()}`;
  const dataset = await buildMergedTrainingDataset();
  const minSamples = getMinSamples();

  if (dataset.labeledCount < minSamples) {
    const run: RetrainRunRecord = {
      id,
      startedAt,
      finishedAt: new Date().toISOString(),
      trigger: trigger ?? "manual",
      ok: false,
      samples: dataset.labeledCount,
      backtestSamples: dataset.backtestCount,
      liveSamples: dataset.liveCount,
      error: `insufficient_samples (need ${minSamples}, got ${dataset.labeledCount})`,
    };
    await appendRun(run);
    return { run, decision, skipped: false };
  }

  const result = await runMlRetrain();
  const run: RetrainRunRecord = {
    id,
    startedAt,
    finishedAt: new Date().toISOString(),
    trigger: trigger ?? "manual",
    ok: result.ok,
    samples: result.samples,
    backtestSamples: dataset.backtestCount,
    liveSamples: dataset.liveCount,
    weightsPath: result.weightsPath,
    error: result.error,
  };

  await appendRun(run);
  return { run, decision, skipped: false };
}

async function appendRun(run: RetrainRunRecord): Promise<void> {
  const state = await loadState();
  state.lastRun = run;
  state.history = [run, ...state.history].slice(0, 30);
  const intervalDays = getIntervalDays();
  state.nextScheduledAt = new Date(
    Date.now() + intervalDays * 24 * 60 * 60_000
  ).toISOString();
  await saveState(state);
}
