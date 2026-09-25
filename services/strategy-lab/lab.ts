/**
 * Strategy lab: would trading the model's signals have made money after fees?
 *
 * The model is refit walk-forward (each fold trains only on the past), every bar gets an
 * out-of-sample P(up), and a grid of trade setups (stop in ATR, reward:risk, holding time,
 * minimum signal strength) is simulated bar by bar: one position per coin at a time, the stop
 * wins when a candle touches both levels, exit at the horizon close otherwise, Binance fees paid.
 *
 * With 100+ setups the best one always looks good by luck, so the setup is chosen on the first
 * 60% of the out-of-sample period and judged only on the last 40% it never saw.
 */

import type { Candle } from "@/types";

/** Binance futures round-trip fees as a fraction of notional. */
export const LAB_FEES = { maker: 0.0004, taker: 0.001 } as const;

export interface TradeSetup {
  /** Stop distance in ATR(14) of the model's bar interval */
  slAtr: number;
  /** Take-profit distance = rr × stop distance */
  rr: number;
  /** Maximum holding time in bars; the position closes at that bar's close */
  horizon: number;
  /** Trade only when |P(up) − 0.5| is at least this */
  minEdge: number;
}

export interface LabMetrics {
  trades: number;
  winRate: number;
  /** Average result per trade after maker (limit order) fees, basis points */
  avgNetBp: number;
  /** Same with taker (market order) fees */
  avgNetBpTaker: number;
  /** avgNet / standard error — how far from luck the average is */
  tStat: number;
  /** Sum of per-trade results after maker fees, % of one position's notional */
  totalPct: number;
  maxDrawdownPct: number;
  tradesPerWeek: number;
}

export interface StrategyReport {
  evaluatedAt: string;
  fees: typeof LAB_FEES;
  setupsTested: number;
  selectionPeriod: { from: string; to: string };
  holdoutPeriod: { from: string; to: string };
  /** Best setup by the selection period; null when no setup had enough trades there */
  best: { setup: TradeSetup; selection: LabMetrics; holdout: LabMetrics } | null;
  /** True only when the chosen setup also made money on the unseen holdout period */
  profitable: boolean;
  reason: string;
}

/** One out-of-sample prediction: bar `index` of `candles`, with the model's P(up) and ATR. */
export interface LabPoint {
  symbol: string;
  time: number;
  index: number;
  pUp: number;
  atr: number;
}

export function atr14(candles: Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  let a = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1].close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
    a = i <= 14 ? a + tr / 14 : (a * 13 + tr) / 14;
    if (i >= 14) out[i] = a;
  }
  return out;
}

/** Bracket trade opened at bar i's close. Returns gross return and the bar where it closed. */
export function simulateBracket(
  candles: Candle[],
  i: number,
  side: 1 | -1,
  tpDist: number,
  slDist: number,
  horizon: number
): { ret: number; exitIndex: number } {
  const entry = candles[i].close;
  const last = Math.min(i + horizon, candles.length - 1);
  for (let j = i + 1; j <= last; j++) {
    const c = candles[j];
    const slHit = side > 0 ? c.low <= entry - slDist : c.high >= entry + slDist;
    const tpHit = side > 0 ? c.high >= entry + tpDist : c.low <= entry - tpDist;
    if (slHit) return { ret: -slDist / entry, exitIndex: j };
    if (tpHit) return { ret: tpDist / entry, exitIndex: j };
  }
  return { ret: (side * (candles[last].close - entry)) / entry, exitIndex: last };
}

interface Trade {
  time: number;
  gross: number;
}

/** Simulates one setup: at most one open position per coin, trades taken in time order. */
export function runSetup(points: LabPoint[], candlesBySymbol: Map<string, Candle[]>, setup: TradeSetup): Trade[] {
  const busyUntil = new Map<string, number>();
  const trades: Trade[] = [];
  for (const p of points) {
    const edge = p.pUp - 0.5;
    if (Math.abs(edge) < setup.minEdge || !(p.atr > 0)) continue;
    if ((busyUntil.get(p.symbol) ?? -1) >= p.index) continue;
    const candles = candlesBySymbol.get(p.symbol)!;
    if (p.index + 1 >= candles.length) continue;
    const sl = p.atr * setup.slAtr;
    const { ret, exitIndex } = simulateBracket(candles, p.index, edge > 0 ? 1 : -1, sl * setup.rr, sl, setup.horizon);
    busyUntil.set(p.symbol, exitIndex);
    trades.push({ time: p.time, gross: ret });
  }
  return trades;
}

export function metricsOf(trades: Trade[], periodMs: number): LabMetrics {
  const n = trades.length;
  if (!n) {
    return { trades: 0, winRate: 0, avgNetBp: 0, avgNetBpTaker: 0, tStat: 0, totalPct: 0, maxDrawdownPct: 0, tradesPerWeek: 0 };
  }
  const net = trades.map((t) => t.gross - LAB_FEES.maker);
  const mean = net.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(net.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1));
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of [...trades].sort((a, b) => a.time - b.time).map((t) => t.gross - LAB_FEES.maker)) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  return {
    trades: n,
    winRate: net.filter((v) => v > 0).length / n,
    avgNetBp: mean * 1e4,
    avgNetBpTaker: (mean + LAB_FEES.maker - LAB_FEES.taker) * 1e4,
    tStat: sd > 0 ? (mean / sd) * Math.sqrt(n) : 0,
    totalPct: equity * 100,
    maxDrawdownPct: maxDd * 100,
    tradesPerWeek: periodMs > 0 ? n / (periodMs / (7 * 86_400_000)) : 0,
  };
}

export function setupGrid(baseHorizon: number): TradeSetup[] {
  const grid: TradeSetup[] = [];
  for (const slAtr of [0.75, 1, 1.5, 2])
    for (const rr of [1, 1.5, 2, 3])
      for (const mult of [1, 2, 4])
        for (const minEdge of [0.02, 0.04, 0.06]) grid.push({ slAtr, rr, horizon: baseHorizon * mult, minEdge });
  return grid;
}

/** Minimum evidence before a setup counts as profitable on the holdout. */
const MIN_SELECTION_TRADES = 50;
const MIN_HOLDOUT_TRADES = 30;
const MIN_HOLDOUT_T = 1.5;

export function evaluateStrategies(
  points: LabPoint[],
  candlesBySymbol: Map<string, Candle[]>,
  baseHorizon: number,
  grid: TradeSetup[] = setupGrid(baseHorizon)
): StrategyReport {
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const iso = (t: number) => new Date(t).toISOString();
  const empty = (reason: string): StrategyReport => ({
    evaluatedAt: new Date().toISOString(),
    fees: LAB_FEES,
    setupsTested: grid.length,
    selectionPeriod: { from: "", to: "" },
    holdoutPeriod: { from: "", to: "" },
    best: null,
    profitable: false,
    reason,
  });
  if (sorted.length < 500) return empty("мало данных для проверки");

  const split = sorted[Math.floor(sorted.length * 0.6)].time;
  const selection = sorted.filter((p) => p.time < split);
  const holdout = sorted.filter((p) => p.time >= split);
  const selSpan = split - sorted[0].time;
  const holdSpan = sorted[sorted.length - 1].time - split;

  let best: { setup: TradeSetup; selection: LabMetrics } | null = null;
  for (const setup of grid) {
    const m = metricsOf(runSetup(selection, candlesBySymbol, setup), selSpan);
    if (m.trades < MIN_SELECTION_TRADES) continue;
    if (!best || m.tStat > best.selection.tStat) best = { setup, selection: m };
  }

  const report = empty("");
  report.selectionPeriod = { from: iso(sorted[0].time), to: iso(split) };
  report.holdoutPeriod = { from: iso(split), to: iso(sorted[sorted.length - 1].time) };
  if (!best) {
    report.reason = "ни одна настройка не дала достаточно сделок";
    return report;
  }

  const hold = metricsOf(runSetup(holdout, candlesBySymbol, best.setup), holdSpan);
  report.best = { ...best, holdout: hold };
  if (best.selection.avgNetBp <= 0) {
    report.reason = `даже лучшая из ${grid.length} настроек убыточна после комиссий (${best.selection.avgNetBp.toFixed(1)} п. на сделку)`;
  } else if (hold.trades < MIN_HOLDOUT_TRADES) {
    report.reason = `на проверочном периоде слишком мало сделок (${hold.trades})`;
  } else if (hold.avgNetBp <= 0) {
    report.reason = `прибыль не подтвердилась на новых данных (${hold.avgNetBp.toFixed(1)} п. на сделку после комиссий)`;
  } else if (hold.tStat < MIN_HOLDOUT_T) {
    report.reason = `прибыль на новых данных неотличима от случайности (t = ${hold.tStat.toFixed(1)})`;
  } else {
    report.profitable = true;
    report.reason = `на новых данных +${hold.avgNetBp.toFixed(1)} п. на сделку после комиссий (${hold.trades} сделок, t = ${hold.tStat.toFixed(1)})`;
  }
  return report;
}
