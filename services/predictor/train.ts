/**
 * Dataset building, walk-forward validation and final fit for the price predictor.
 */

import type { Candle, Timeframe } from "@/types";
import { HORIZONS } from "@/services/predictor/config";
import { computeFeatureSeries, FEATURE_NAMES, type FeatureContext } from "@/services/predictor/features";
import {
  computeMoveQuantiles,
  featureContributions,
  fitExpectedMove,
  fitGbm,
  fitLogistic,
  gbmContributions,
  predictGbm,
  predictProbability,
  type GbmModel,
  type LogisticModel,
  type MoveQuantiles,
} from "@/services/predictor/model";

export type Classifier = { kind: "logistic"; logistic: LogisticModel } | { kind: "gbm"; gbm: GbmModel };

export interface CandidateSpec {
  name: string;
  kind: Classifier["kind"];
  /**
   * Skip training rows whose move is smaller than a round-trip fee: they are coin flips the model can't
   * profit from anyway. Validation still scores every row.
   */
  feeDeadZone: boolean;
}

export const CANDIDATES: CandidateSpec[] = [
  { name: "logistic", kind: "logistic", feeDeadZone: false },
  { name: "logistic+fee", kind: "logistic", feeDeadZone: true },
  { name: "gbm", kind: "gbm", feeDeadZone: false },
  { name: "gbm+fee", kind: "gbm", feeDeadZone: true },
];

/** Round-trip taker fee on Binance futures, as a fraction. */
export const FEE_DEAD_ZONE = 0.001;

export function predictClassifier(c: Classifier, x: number[]): number {
  return c.kind === "gbm" ? predictGbm(c.gbm, x) : predictProbability(c.logistic, x);
}

export function classifierContributions(c: Classifier, x: number[], names: readonly string[]) {
  return c.kind === "gbm" ? gbmContributions(c.gbm, x, names) : featureContributions(c.logistic, x, names);
}

function fitClassifier(train: Sample[], spec: CandidateSpec): Classifier {
  const rows = spec.feeDeadZone ? train.filter((s) => Math.abs(s.ret) >= FEE_DEAD_ZONE) : train;
  const X = rows.map((s) => s.x);
  const y = rows.map((s) => s.y);
  return spec.kind === "gbm" ? { kind: "gbm", gbm: fitGbm(X, y) } : { kind: "logistic", logistic: fitLogistic(X, y) };
}

export interface Sample {
  symbol: string;
  time: number;
  x: number[];
  /** 1 = close went up over the horizon */
  y: number;
  /** Close move in volatility units */
  z: number;
  /** Raw close-to-close return over the horizon */
  ret: number;
  zHigh: number;
  zLow: number;
}

export interface ValidationReport {
  folds: number;
  samples: number;
  /** Share of correct up/down calls */
  accuracy: number;
  /** Accuracy of always calling the direction that dominated the training window */
  baselineAccuracy: number;
  logLoss: number;
  baselineLogLoss: number;
  brier: number;
  auc: number;
  /** Share of real closes that landed inside the predicted 10–90% band (target ≈ 0.8) */
  band80Coverage: number;
  /** Calls where the model was ≥ 55% sure */
  confident: { share: number; accuracy: number };
  /** Accuracy gain over baseline in standard errors (overlapping horizons accounted for) */
  zScore: number;
  /** True only if the model beats the baseline on both accuracy and log-loss, with z ≥ 2 */
  hasEdge: boolean;
}

export interface CandidateReport {
  name: string;
  accuracy: number;
  logLoss: number;
  baselineLogLoss: number;
  confidentAccuracy: number;
  hasEdge: boolean;
}

export interface PredictorModel {
  version: 2;
  timeframe: Timeframe;
  interval: string;
  horizon: number;
  featureNames: string[];
  /** Name of the candidate that won walk-forward validation */
  chosen: string;
  classifier: Classifier;
  candidates: CandidateReport[];
  expectedMove: { intercept: number; slope: number };
  quantiles: MoveQuantiles;
  validation: ValidationReport;
  trainedAt: string;
  source: string;
  symbols: string[];
  dataFrom: string;
  dataTo: string;
  samples: number;
}

export function buildSamples(
  symbol: string,
  candles: Candle[],
  horizon: number,
  context: FeatureContext = {}
): Sample[] {
  const { rows, vol } = computeFeatureSeries(candles, context);
  const samples: Sample[] = [];
  for (let i = 0; i + horizon < candles.length; i++) {
    const x = rows[i];
    if (!x) continue;
    const unit = vol[i] * Math.sqrt(horizon);
    const close = candles[i].close;
    const future = candles[i + horizon].close;
    if (future === close) continue;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i + 1; j <= i + horizon; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
    }
    samples.push({
      symbol,
      time: candles[i].openTime,
      x,
      y: future > close ? 1 : 0,
      z: Math.log(future / close) / unit,
      ret: future / close - 1,
      zHigh: Math.log(hi / close) / unit,
      zLow: Math.log(lo / close) / unit,
    });
  }
  return samples;
}

function logLoss(p: number, y: number): number {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
}

function auc(scores: number[], labels: number[]): number {
  const order = scores.map((s, i) => [s, labels[i]] as const).sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  let positives = 0;
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j < order.length && order[j][0] === order[i][0]) j++;
    const avgRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) {
      if (order[k][1] === 1) {
        rankSum += avgRank;
        positives++;
      }
    }
    i = j;
  }
  const negatives = order.length - positives;
  if (!positives || !negatives) return 0.5;
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

function fitComponents(train: Sample[], spec: CandidateSpec) {
  const classifier = fitClassifier(train, spec);
  const quantiles = computeMoveQuantiles(
    train.map((s) => s.z),
    train.map((s) => s.zHigh),
    train.map((s) => s.zLow)
  );
  const p = train.map((s) => predictClassifier(classifier, s.x));
  const expectedMove = fitExpectedMove(
    p,
    train.map((s) => s.z)
  );
  return { classifier, quantiles, expectedMove };
}

/**
 * Expanding-window walk-forward: each fold trains only on the past,
 * with a horizon-long gap so no training label overlaps the test period.
 */
export function walkForward(
  samples: Sample[],
  horizon: number,
  intervalMinutes: number,
  folds = 5,
  spec: CandidateSpec = CANDIDATES[0]
): ValidationReport {
  const sorted = [...samples].sort((a, b) => a.time - b.time);
  const gapMs = horizon * intervalMinutes * 60_000;
  const chunk = Math.floor(sorted.length / (folds + 1));

  const probs: number[] = [];
  const labels: number[] = [];
  let baselineHits = 0;
  let baselineLoss = 0;
  let inBand = 0;

  for (let k = 1; k <= folds; k++) {
    const testStart = sorted[k * chunk].time;
    const testEnd = k === folds ? Infinity : sorted[(k + 1) * chunk].time;
    const train = sorted.filter((s) => s.time < testStart - gapMs);
    const test = sorted.filter((s) => s.time >= testStart && s.time < testEnd);
    if (train.length < 200 || !test.length) continue;

    const { classifier, quantiles } = fitComponents(train, spec);
    const baseRate = train.reduce((s, v) => s + v.y, 0) / train.length;
    const baselineCall = baseRate >= 0.5 ? 1 : 0;

    for (const s of test) {
      probs.push(predictClassifier(classifier, s.x));
      labels.push(s.y);
      if (s.y === baselineCall) baselineHits++;
      baselineLoss += logLoss(baseRate, s.y);
      if (s.z >= quantiles.close.q10 && s.z <= quantiles.close.q90) inBand++;
    }
  }

  const n = probs.length;
  if (!n) throw new Error("walkForward: not enough samples for validation");

  let hits = 0;
  let loss = 0;
  let brier = 0;
  let confidentN = 0;
  let confidentHits = 0;
  for (let i = 0; i < n; i++) {
    const call = probs[i] >= 0.5 ? 1 : 0;
    if (call === labels[i]) hits++;
    loss += logLoss(probs[i], labels[i]);
    brier += (probs[i] - labels[i]) ** 2;
    if (Math.abs(probs[i] - 0.5) >= 0.05) {
      confidentN++;
      if (call === labels[i]) confidentHits++;
    }
  }

  const accuracy = hits / n;
  const baselineAccuracy = baselineHits / n;
  const effectiveN = n / horizon;
  const se = Math.sqrt((baselineAccuracy * (1 - baselineAccuracy)) / effectiveN) || 1;
  const zScore = (accuracy - baselineAccuracy) / se;
  const report: ValidationReport = {
    folds,
    samples: n,
    accuracy,
    baselineAccuracy,
    logLoss: loss / n,
    baselineLogLoss: baselineLoss / n,
    brier: brier / n,
    auc: auc(probs, labels),
    band80Coverage: inBand / n,
    confident: {
      share: confidentN / n,
      accuracy: confidentN ? confidentHits / confidentN : 0,
    },
    zScore,
    hasEdge: false,
  };
  report.hasEdge = report.accuracy > report.baselineAccuracy && report.logLoss < report.baselineLogLoss && zScore >= 2;
  return report;
}

export function trainPredictor(
  timeframe: Timeframe,
  series: Array<{ symbol: string; candles: Candle[] }>,
  source: string,
  options: { btc?: Candle[]; candidates?: CandidateSpec[]; log?: (line: string) => void } = {}
): PredictorModel {
  const spec = HORIZONS[timeframe];
  const samples = series.flatMap((s) =>
    buildSamples(s.symbol, s.candles, spec.horizon, { btc: options.btc ?? (s.symbol === "BTCUSDT" ? s.candles : undefined) })
  );
  if (samples.length < 500) {
    throw new Error(`${timeframe}: only ${samples.length} samples — need at least 500`);
  }

  // Every candidate is judged on the same walk-forward folds; the lowest out-of-sample log-loss wins.
  const results = (options.candidates ?? CANDIDATES).map((candidate) => {
    const validation = walkForward(samples, spec.horizon, spec.intervalMinutes, 5, candidate);
    options.log?.(
      `  ${candidate.name.padEnd(13)} точность ${(validation.accuracy * 100).toFixed(1)}% · log-loss ${validation.logLoss.toFixed(4)}${validation.hasEdge ? " · преимущество" : ""}`
    );
    return { candidate, validation };
  });
  const best = results.reduce((a, b) => (b.validation.logLoss < a.validation.logLoss ? b : a));

  const { classifier, quantiles, expectedMove } = fitComponents(samples, best.candidate);
  const firstTime = samples.reduce((m, s) => Math.min(m, s.time), Infinity);
  const lastTime = samples.reduce((m, s) => Math.max(m, s.time), -Infinity);

  return {
    version: 2,
    timeframe,
    interval: spec.interval,
    horizon: spec.horizon,
    featureNames: [...FEATURE_NAMES],
    chosen: best.candidate.name,
    classifier,
    candidates: results.map(({ candidate, validation: v }) => ({
      name: candidate.name,
      accuracy: v.accuracy,
      logLoss: v.logLoss,
      baselineLogLoss: v.baselineLogLoss,
      confidentAccuracy: v.confident.accuracy,
      hasEdge: v.hasEdge,
    })),
    expectedMove,
    quantiles,
    validation: best.validation,
    trainedAt: new Date().toISOString(),
    source,
    symbols: series.map((s) => s.symbol),
    dataFrom: new Date(firstTime).toISOString(),
    dataTo: new Date(lastTime).toISOString(),
    samples: samples.length,
  };
}
