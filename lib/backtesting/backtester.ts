/**
 * Walk-forward backtesting on Binance historical candles.
 */

import { TIMEFRAME_DURATION_MS } from "@/lib/accuracy";
import { buildHistoricalContext } from "@/lib/backtesting/historical-context";
import { computeBacktestMetrics } from "@/lib/backtesting/metrics";
import { buildProxyLlmPrediction } from "@/lib/backtesting/proxy-llm";
import { saveRegimePerformance } from "@/lib/backtesting/performance-store";
import { saveBacktestRun } from "@/lib/backtesting/runs-store";
import {
  buildTrainingRecord,
  writeTrainingJsonl,
  type BacktestTrainingRecord,
} from "@/lib/backtesting/training-export";
import type {
  BacktestConfig,
  BacktestReport,
  BacktestTrade,
  TrainingExportResult,
  WalkForwardFold,
} from "@/lib/backtesting/types";
import { TIMEFRAME_CANDLE_CONFIG } from "@/lib/timeframe";
import { fetchCandlesInRange } from "@/services/binance";
import { isComponentCorrect } from "@/services/ensemble-meta";
import { EnsemblePredictor } from "@/services/ensemble-prediction";
import { extractMlFeatures } from "@/services/ml-features";
import { generatePrediction } from "@/services/ai-prediction";
import { runMlRetrain } from "@/services/ml-retrain";
import type { Candle, Coin, MarketRegime, PredictionDirection } from "@/types";

interface SliceResult {
  trades: BacktestTrade[];
  training: BacktestTrainingRecord[];
}

function tradeReturnPct(direction: PredictionDirection, entry: number, exit: number): number {
  const raw = ((exit - entry) / entry) * 100;
  if (direction === "LONG") return raw;
  if (direction === "SHORT") return -raw;
  return Math.abs(raw) < 0.1 ? 0 : raw * 0.25;
}

function findExitPrice(candles: Candle[], decisionTime: number, horizonMs: number): number | null {
  const target = decisionTime + horizonMs;
  const future = candles.filter((c) => c.openTime >= decisionTime);
  if (!future.length) return null;
  let best = future[0];
  for (const c of future) {
    if (c.openTime <= target) best = c;
    else break;
  }
  return best.close;
}

async function loadHistoricalCandles(
  symbol: string,
  market: BacktestConfig["market"],
  timeframe: BacktestConfig["timeframe"],
  startMs: number,
  endMs: number
): Promise<Record<string, Candle[]>> {
  const config = TIMEFRAME_CANDLE_CONFIG[timeframe];
  const intervals = [...new Set([...config.contextIntervals, config.aggregateFrom].filter(Boolean))] as string[];
  const map: Record<string, Candle[]> = {};

  await Promise.all(
    intervals.map(async (interval) => {
      try {
        map[interval] = await fetchCandlesInRange(symbol, interval, market, startMs, endMs);
      } catch {
        map[interval] = [];
      }
    })
  );

  return map;
}

export class Backtester {
  private readonly predictor = new EnsemblePredictor();
  private lastTrainingRecords: BacktestTrainingRecord[] = [];

  /**
   * Export training JSONL from collected or provided records.
   */
  async exportTrainingData(
    records?: BacktestTrainingRecord[]
  ): Promise<TrainingExportResult> {
    const data = records ?? this.lastTrainingRecords;
    return writeTrainingJsonl(data);
  }

  async run(config: BacktestConfig, coin: Coin): Promise<BacktestReport> {
    const periodDays = Math.min(730, Math.max(7, config.periodDays));
    const endMs = Date.now();
    const startMs = endMs - periodDays * 24 * 60 * 60_000;
    const maxTrades = config.maxTrades ?? 120;
    const mode = config.mode ?? "ensemble";
    const collectTraining = config.exportTraining === true;
    const notes: string[] = [];

    notes.push(
      mode === "ensemble"
        ? "Mode ensemble: proxy LLM + ML + rules (no OpenRouter per bar)."
        : "Mode full: real LLM on last sample only."
    );

    const allCandles = await loadHistoricalCandles(
      coin.symbol,
      config.market,
      config.timeframe,
      startMs - 90 * 24 * 60 * 60_000,
      endMs
    );

    const primaryInterval = TIMEFRAME_CANDLE_CONFIG[config.timeframe].primaryInterval;
    const primary = allCandles[primaryInterval] ?? [];
    const horizonMs = TIMEFRAME_DURATION_MS[config.timeframe] ?? 24 * 60 * 60_000;

    const slice = await this.runSlice(
      coin,
      config,
      allCandles,
      primary,
      horizonMs,
      startMs,
      endMs,
      maxTrades,
      mode,
      collectTraining
    );

    this.lastTrainingRecords = slice.training;
    const trades = slice.trades;
    const metrics = computeBacktestMetrics(trades, config.timeframe);

    if (config.useDynamicWeights !== false && metrics.accuracyByRegime.length) {
      await saveRegimePerformance(metrics.accuracyByRegime).catch(() => undefined);
      notes.push("Regime performance saved to .cache/regime-performance.json");
    }

    let walkForward: WalkForwardFold[] | undefined;
    if (config.walkForward) {
      walkForward = await this.runWalkForward(config, coin, allCandles, primary, horizonMs, collectTraining);
      notes.push(`Walk-forward: ${walkForward.length} folds.`);
    }

    let trainingExport: TrainingExportResult | undefined;
    if (config.exportTraining && slice.training.length > 0) {
      trainingExport = await this.exportTrainingData(slice.training);
      notes.push(
        `Training JSONL: ${trainingExport.path} (${trainingExport.labeledCount} labeled / ${trainingExport.count} total)`
      );
    }

    let mlRetrain: BacktestReport["mlRetrain"];
    if (config.retrainMl && trainingExport && trainingExport.labeledCount > 0) {
      mlRetrain = await runMlRetrain();
      notes.push(
        mlRetrain.ok
          ? `ML retrain OK: ${mlRetrain.samples} samples → ${mlRetrain.weightsPath}`
          : `ML retrain failed: ${mlRetrain.error}`
      );
    }

    const report: BacktestReport = {
      symbol: coin.symbol,
      market: config.market,
      timeframe: config.timeframe,
      periodStart: startMs,
      periodEnd: endMs,
      mode,
      trades,
      metrics,
      walkForward,
      generatedAt: new Date().toISOString(),
      notes,
      trainingExport,
      mlRetrain,
    };

    report.runId = await saveBacktestRun(report, {
      periodDays,
      trainingExported: !!trainingExport,
      trainingSamples: trainingExport?.labeledCount,
      mlRetrained: mlRetrain?.ok,
    });

    return report;
  }

  private async runWalkForward(
    config: BacktestConfig,
    coin: Coin,
    allCandles: Record<string, Candle[]>,
    primary: Candle[],
    horizonMs: number,
    collectTraining: boolean
  ): Promise<WalkForwardFold[]> {
    const wf = config.walkForward!;
    const folds: WalkForwardFold[] = [];
    const endMs = Date.now();
    const totalMs = Math.min(730, config.periodDays) * 24 * 60 * 60_000;
    const startMs = endMs - totalMs;
    const trainMs = wf.trainDays * 24 * 60 * 60_000;
    const testMs = wf.testDays * 24 * 60 * 60_000;
    const stepMs = wf.stepDays * 24 * 60 * 60_000;

    let fold = 0;
    for (let cursor = startMs + trainMs; cursor + testMs <= endMs; cursor += stepMs) {
      const trainSlice = await this.runSlice(
        coin,
        config,
        allCandles,
        primary,
        horizonMs,
        cursor - trainMs,
        cursor,
        40,
        "ensemble",
        false
      );
      const testSlice = await this.runSlice(
        coin,
        config,
        allCandles,
        primary,
        horizonMs,
        cursor,
        cursor + testMs,
        40,
        "ensemble",
        false
      );

      const trainMetrics = computeBacktestMetrics(trainSlice.trades, config.timeframe);
      await saveRegimePerformance(trainMetrics.accuracyByRegime).catch(() => undefined);

      folds.push({
        fold: fold++,
        trainStart: cursor - trainMs,
        trainEnd: cursor,
        testStart: cursor,
        testEnd: cursor + testMs,
        trainMetrics,
        testMetrics: computeBacktestMetrics(testSlice.trades, config.timeframe),
        regimeStats: trainMetrics.accuracyByRegime,
      });
    }

    return folds;
  }

  private async runSlice(
    coin: Coin,
    config: BacktestConfig,
    allCandles: Record<string, Candle[]>,
    primary: Candle[],
    horizonMs: number,
    startMs: number,
    endMs: number,
    maxTrades: number,
    mode: BacktestConfig["mode"] = "ensemble",
    collectTraining = false
  ): Promise<SliceResult> {
    const points = primary
      .filter((c) => c.closeTime >= startMs && c.closeTime <= endMs - horizonMs)
      .map((c) => c.closeTime);
    const sampled =
      points.length > maxTrades
        ? points.filter((_, i) => i % Math.ceil(points.length / maxTrades) === 0)
        : points;

    const trades: BacktestTrade[] = [];
    const training: BacktestTrainingRecord[] = [];

    for (const asOf of sampled) {
      const built = buildHistoricalContext(coin, config.market, config.timeframe, allCandles, asOf);
      if (!built) continue;
      const { context, snapshot } = built;
      const entry = context.marketData.price;
      const exit = findExitPrice(primary, asOf, horizonMs);
      if (!exit) continue;

      let llmPred = buildProxyLlmPrediction(context, snapshot);
      if (mode === "full" && asOf === sampled[sampled.length - 1]) {
        try {
          llmPred = await generatePrediction(context);
        } catch {
          // keep proxy
        }
      }

      const { prediction, breakdown } = await this.predictor.combine(context, snapshot, llmPred, {
        useDynamicWeights: config.useDynamicWeights !== false,
      });

      const rulesDir: PredictionDirection =
        breakdown.rulesAggregateScore > 0.08
          ? "LONG"
          : breakdown.rulesAggregateScore < -0.08
            ? "SHORT"
            : "SIDEWAYS";

      trades.push({
        timestamp: asOf,
        timeframe: config.timeframe,
        regime: snapshot.marketRegime?.regime ?? "Low Conviction",
        direction: prediction.direction,
        probability: prediction.probability,
        confidence: prediction.confidence,
        ensembleScore: prediction.ensembleScore ?? 0,
        entryPrice: entry,
        exitPrice: exit,
        returnPct: Math.round(tradeReturnPct(prediction.direction, entry, exit) * 10000) / 10000,
        won: isComponentCorrect(prediction.direction, entry, exit),
        llmCorrect: isComponentCorrect(breakdown.llm.direction, entry, exit),
        mlCorrect: breakdown.mlAvailable
          ? isComponentCorrect(breakdown.ml.direction, entry, exit)
          : false,
        rulesCorrect: isComponentCorrect(rulesDir, entry, exit),
      });

      if (collectTraining) {
        const features = extractMlFeatures(context);
        const regime: MarketRegime = snapshot.marketRegime ?? {
          regime: "Low Conviction",
          confidence: 50,
          score: 0,
          signals: [],
        };
        training.push(
          buildTrainingRecord({
            timestamp: asOf,
            symbol: coin.symbol,
            timeframe: config.timeframe,
            features: features.values,
            regime,
            ensembleBreakdown: breakdown,
            entryPrice: entry,
            exitPrice: exit,
          })
        );
      }
    }

    return { trades, training };
  }
}

export const backtester = new Backtester();
