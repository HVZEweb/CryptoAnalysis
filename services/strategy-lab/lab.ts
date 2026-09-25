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

/** Binance futures round-trip fees as a fraction of notional (kept for reports that quote them). */
export const LAB_FEES = { maker: 0.0004, taker: 0.001 } as const;

/**
 * How a signal is actually executed, per side, as a fraction of notional. The signal is known only at
 * the bar's close, so the entry is a market order (taker fee + slippage). The take-profit is a resting
 * limit order (maker fee, no slippage); the stop and the time exit are market orders again.
 * This — not "everything at the close with maker fees" — decides whether a setup counts as profitable.
 */
export const LAB_EXECUTION = { makerFee: 0.0002, takerFee: 0.0005, slippage: 0.0003 } as const;

export type ExitKind = "tp" | "sl" | "time";

/** Round-trip cost of one trade by how it ended; `allMarket` — also the take-profit as a market order. */
export function tradeCost(exit: ExitKind, allMarket = false): number {
  const market = LAB_EXECUTION.takerFee + LAB_EXECUTION.slippage;
  const out = exit === "tp" && !allMarket ? LAB_EXECUTION.makerFee : market;
  return market + out;
}

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
  /** Average result per trade after realistic execution costs (LAB_EXECUTION), basis points */
  avgNetBp: number;
  /** Same if the take-profit were also hit with a market order — the worst case */
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
  /** Execution cost model the results were computed with (absent in reports made before it existed) */
  execution?: typeof LAB_EXECUTION;
  setupsTested: number;
  selectionPeriod: { from: string; to: string };
  holdoutPeriod: { from: string; to: string };
  /** Best setup by the selection period; null when no setup had enough trades there */
  best: { setup: TradeSetup; selection: LabMetrics; holdout: LabMetrics } | null;
  /** True only when the chosen setup also made money on the unseen holdout period */
  profitable: boolean;
  reason: string;
  /** The chosen setup's holdout result per coin — whether it also paid on that particular coin */
  bySymbol?: Record<string, LabMetrics>;
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
): { ret: number; exitIndex: number; exit: ExitKind } {
  const entry = candles[i].close;
  const last = Math.min(i + horizon, candles.length - 1);
  for (let j = i + 1; j <= last; j++) {
    const c = candles[j];
    const slHit = side > 0 ? c.low <= entry - slDist : c.high >= entry + slDist;
    const tpHit = side > 0 ? c.high >= entry + tpDist : c.low <= entry - tpDist;
    if (slHit) return { ret: -slDist / entry, exitIndex: j, exit: "sl" };
    if (tpHit) return { ret: tpDist / entry, exitIndex: j, exit: "tp" };
  }
  return { ret: (side * (candles[last].close - entry)) / entry, exitIndex: last, exit: "time" };
}

interface Trade {
  symbol: string;
  time: number;
  gross: number;
  exit: ExitKind;
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
    const { ret, exitIndex, exit } = simulateBracket(candles, p.index, edge > 0 ? 1 : -1, sl * setup.rr, sl, setup.horizon);
    busyUntil.set(p.symbol, exitIndex);
    trades.push({ symbol: p.symbol, time: p.time, gross: ret, exit });
  }
  return trades;
}

export function metricsOf(trades: Array<Pick<Trade, "time" | "gross" | "exit">>, periodMs: number): LabMetrics {
  const n = trades.length;
  if (!n) {
    return { trades: 0, winRate: 0, avgNetBp: 0, avgNetBpTaker: 0, tStat: 0, totalPct: 0, maxDrawdownPct: 0, tradesPerWeek: 0 };
  }
  const netOf = (t: Pick<Trade, "gross" | "exit">) => t.gross - tradeCost(t.exit);
  const net = trades.map(netOf);
  const mean = net.reduce((s, v) => s + v, 0) / n;
  const worst = trades.reduce((s, t) => s + t.gross - tradeCost(t.exit, true), 0) / n;
  const sd = Math.sqrt(net.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1));
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of [...trades].sort((a, b) => a.time - b.time).map(netOf)) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  return {
    trades: n,
    winRate: net.filter((v) => v > 0).length / n,
    avgNetBp: mean * 1e4,
    avgNetBpTaker: worst * 1e4,
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
    execution: LAB_EXECUTION,
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

  const holdTrades = runSetup(holdout, candlesBySymbol, best.setup);
  const hold = metricsOf(holdTrades, holdSpan);
  report.best = { ...best, holdout: hold };
  const perSymbol = new Map<string, Trade[]>();
  for (const t of holdTrades) perSymbol.set(t.symbol, [...(perSymbol.get(t.symbol) ?? []), t]);
  report.bySymbol = Object.fromEntries([...perSymbol].map(([s, trades]) => [s, metricsOf(trades, holdSpan)]));
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
