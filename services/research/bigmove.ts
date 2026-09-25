/**
 * "Big move" models: instead of up vs down, predict which of ±θ price reaches first within H bars
 * (triple-barrier labels). A trade is taken only when one side is clearly more likely, with the
 * target and stop at the barriers — so every winning trade is several times larger than its cost.
 *
 * Two classifiers per configuration (up-first, down-first) are refit walk-forward on the pooled
 * features; their out-of-sample probabilities drive the trade simulation.
 */

import type { Candle } from "@/types";
import { fitGbm, predictGbm } from "@/services/predictor/model";
import { selectAndValidate, simulateIntents, type Candidate, type ResearchVerdict, type TradeIntent } from "@/services/research/common";

export interface BigMoveConfig {
  /** Barrier as a fraction of price */
  theta: number;
  /** Bars to wait for a barrier */
  horizon: number;
}

export const BIGMOVE_CONFIGS: BigMoveConfig[] = [
  { theta: 0.01, horizon: 12 },
  { theta: 0.01, horizon: 24 },
  { theta: 0.02, horizon: 24 },
];

const MARGINS = [0.03, 0.05, 0.08, 0.12];

/** 1 = up barrier first, -1 = down first, 0 = neither within the horizon (or both inside one bar). */
export function barrierLabel(candles: Candle[], i: number, theta: number, horizon: number): -1 | 0 | 1 | null {
  if (i + horizon >= candles.length) return null;
  const entry = candles[i].close;
  const up = entry * (1 + theta);
  const down = entry * (1 - theta);
  for (let j = i + 1; j <= i + horizon; j++) {
    const hitUp = candles[j].high >= up;
    const hitDown = candles[j].low <= down;
    if (hitUp && hitDown) return 0; // order inside the bar unknown
    if (hitUp) return 1;
    if (hitDown) return -1;
  }
  return 0;
}

interface Sample {
  symbol: string;
  index: number;
  time: number;
  x: number[];
  label: -1 | 0 | 1;
}

export interface BigMoveResult extends ResearchVerdict {
  config: BigMoveConfig;
  samples: number;
  /** Share of samples where each barrier came first */
  baseRates: { up: number; down: number };
  auc: { up: number; down: number };
}

function auc(scores: number[], labels: number[]): number {
  const order = scores.map((s, i) => [s, labels[i]] as const).sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  let pos = 0;
  order.forEach(([, y], i) => {
    if (y === 1) {
      rankSum += i + 1;
      pos++;
    }
  });
  const neg = order.length - pos;
  return pos && neg ? (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) : 0.5;
}

export function studyBigMove(
  series: Array<{ symbol: string; candles: Candle[]; rows: Array<number[] | null> }>,
  config: BigMoveConfig,
  from: number,
  to: number,
  folds = 5,
  log: (line: string) => void = () => undefined
): BigMoveResult {
  const samples: Sample[] = [];
  for (const s of series) {
    for (let i = 0; i < s.rows.length; i++) {
      const x = s.rows[i];
      if (!x) continue;
      const label = barrierLabel(s.candles, i, config.theta, config.horizon);
      if (label === null) continue;
      samples.push({ symbol: s.symbol, index: i, time: s.candles[i].openTime, x, label });
    }
  }
  samples.sort((a, b) => a.time - b.time);
  const n = samples.length;
  const baseRates = { up: samples.filter((s) => s.label === 1).length / n, down: samples.filter((s) => s.label === -1).length / n };

  // Expanding walk-forward; a horizon-long gap keeps training labels out of the test period.
  const gapMs = config.horizon * 3_600_000;
  const chunk = Math.floor(n / (folds + 1));
  const oos: Array<{ s: Sample; pUp: number; pDown: number }> = [];
  for (let k = 1; k <= folds; k++) {
    const testStart = samples[k * chunk].time;
    const testEnd = k === folds ? Infinity : samples[(k + 1) * chunk].time;
    const train = samples.filter((s) => s.time < testStart - gapMs);
    const test = samples.filter((s) => s.time >= testStart && s.time < testEnd);
    if (train.length < 1000 || !test.length) continue;
    const X = train.map((s) => s.x);
    const up = fitGbm(X, train.map((s) => (s.label === 1 ? 1 : 0)));
    const down = fitGbm(X, train.map((s) => (s.label === -1 ? 1 : 0)));
    for (const s of test) oos.push({ s, pUp: predictGbm(up, s.x), pDown: predictGbm(down, s.x) });
    log(`    фолд ${k}/${folds}: обучение ${train.length}, проверка ${test.length}`);
  }

  const candlesBySymbol = new Map(series.map((s) => [s.symbol, s.candles]));
  const candidates: Candidate[] = MARGINS.map((m) => {
    const intents: TradeIntent[] = [];
    for (const { s, pUp, pDown } of oos) {
      const d = pUp - pDown;
      if (Math.abs(d) < m) continue;
      const dist = candlesBySymbol.get(s.symbol)![s.index].close * config.theta;
      intents.push({ symbol: s.symbol, index: s.index, side: d > 0 ? 1 : -1, slDist: dist, tpDist: dist, horizon: config.horizon });
    }
    return { label: `сделка, если P(первым ${config.theta * 100}% вверх) − P(вниз) ≥ ${m * 100} п.п.`, trades: simulateIntents(intents, candlesBySymbol) };
  });

  const title = `Крупное движение ±${config.theta * 100}% за ${config.horizon} ч`;
  // Selection and holdout split the period the models actually predicted out of sample.
  const verdict = selectAndValidate(title, candidates, oos.length ? oos[0].s.time : from, to);
  return {
    ...verdict,
    config,
    samples: n,
    baseRates,
    auc: {
      up: auc(oos.map((o) => o.pUp), oos.map((o) => (o.s.label === 1 ? 1 : 0))),
      down: auc(oos.map((o) => o.pDown), oos.map((o) => (o.s.label === -1 ? 1 : 0))),
    },
  };
}
