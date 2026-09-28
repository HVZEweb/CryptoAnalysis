/**
 * Forward test of the cross-sectional funding strategy: the exact rule of the backtest
 * (services/research/portfolio.ts, fundingStrategy + liquidTop), run day by day on data that did not
 * exist when it was chosen.
 *
 * Declared before the first day (2026-09-28):
 * - Main variant: every Monday after the daily close, among the 100 USDT perpetuals with the highest
 *   30-day average quote volume (listed at least 60 days), long the third with the lowest 7-day average
 *   funding and short the third with the highest; half the capital per side, equal weights.
 *   Chosen after the survivorship-free robustness run (top-100: holdout +25.7%/yr, t = 2.0), so only
 *   data from here on can confirm it. Top-50, the variant declared before that run (t = 1.8), is kept
 *   alongside for comparison.
 * - Costs as in the backtest: 0.05% taker fee + 0.03% slippage per unit traded; funding paid or earned daily.
 * - Judged at 26 weeks: after costs in profit and a drawdown no deeper than the backtest's worst (32%).
 *   Half a year cannot prove the edge (at a Sharpe near 1, t ≥ 2 takes about four years); it shows
 *   whether the rule behaves live as it did on history.
 */

import { fundingStrategy, liquidTop, REBALANCE_COST, type DailyUniverse } from "@/services/research/portfolio";

export const DAY = 86_400_000;
export const CARRY_WINDOW = 7;
/** Trading days a coin must have before it can be picked (liquidTop's default) */
export const CARRY_MIN_DAYS = 60;
export const CARRY_START = Date.UTC(2026, 8, 28);

export interface CarryVariant {
  key: string;
  label: string;
  top: number;
  main: boolean;
}

export const CARRY_VARIANTS: CarryVariant[] = [
  { key: "top100", label: "топ-100 (главный)", top: 100, main: true },
  { key: "top50", label: "топ-50 (для сравнения)", top: 50, main: false },
];

/** The backtest rebalances after Monday's daily close. */
export const isRebalanceDay = (day: number) => new Date(day).getUTCDay() === 1;

export interface CoinDays {
  symbol: string;
  /** Daily bars by UTC day start */
  close: Map<number, number>;
  volume: Map<number, number>;
  /** Sum of funding rates settled during each UTC day */
  funding: Map<number, number>;
}

/** The backtest's universe over [day - CARRY_MIN_DAYS, day], built from live data. */
export function universeAt(day: number, coins: CoinDays[]): DailyUniverse {
  const days = Array.from({ length: CARRY_MIN_DAYS + 1 }, (_, i) => day - (CARRY_MIN_DAYS - i) * DAY);
  return {
    days,
    symbols: coins.map((c) => c.symbol),
    close: coins.map((c) => days.map((d) => c.close.get(d) ?? NaN)),
    volume: coins.map((c) => days.map((d) => c.volume.get(d) ?? NaN)),
    funding: coins.map((c) => days.map((d) => c.funding.get(d) ?? 0)),
  };
}

/** Coins eligible on `day` for a top-N variant (point-in-time liquidity, as in the backtest). */
export function eligibleAt(u: DailyUniverse, top: number): string[] {
  const eligible = liquidTop(top, CARRY_MIN_DAYS);
  const d = u.days.length - 1;
  return u.symbols.filter((_, s) => u.close[s][d] > 0 && eligible(u, s, d));
}

/** Target weights after the close of the universe's last day, keyed by symbol (zeros dropped). */
export function targetWeights(u: DailyUniverse, top: number): Record<string, number> {
  const d = u.days.length - 1;
  const w = fundingStrategy(CARRY_WINDOW, { eligible: liquidTop(top, CARRY_MIN_DAYS) })(u, d, new Array(u.symbols.length).fill(0));
  return Object.fromEntries(u.symbols.map((s, i) => [s, w[i]]).filter(([, x]) => x !== 0));
}

/** Turnover cost of moving from one set of weights to another. */
export function rebalanceCost(from: Record<string, number>, to: Record<string, number>): number {
  const symbols = new Set([...Object.keys(from), ...Object.keys(to)]);
  let traded = 0;
  for (const s of symbols) traded += Math.abs((to[s] ?? 0) - (from[s] ?? 0));
  return traded * REBALANCE_COST;
}

export interface DayMove {
  prevClose?: number;
  close?: number;
  funding: number;
}

/** One day's result of holding `weights`: price moves plus funding (longs pay positive funding). */
export function dayResult(weights: Record<string, number>, moves: Record<string, DayMove>): { price: number; funding: number } {
  let price = 0;
  let funding = 0;
  for (const [s, w] of Object.entries(weights)) {
    const m = moves[s];
    if (!m || !(m.prevClose! > 0) || !(m.close! > 0)) continue; // no bar: no result, as in the backtest
    price += w * (m.close! / m.prevClose! - 1);
    funding -= w * m.funding;
  }
  return { price, funding };
}

export interface CarryStats {
  days: number;
  totalPct: number;
  annualPct: number;
  sharpe: number;
  tStat: number;
  maxDrawdownPct: number;
}

export function carryStats(returns: number[]): CarryStats {
  const n = returns.length;
  if (!n) return { days: 0, totalPct: 0, annualPct: 0, sharpe: 0, tStat: 0, maxDrawdownPct: 0 };
  let equity = 1;
  let peak = 1;
  let dd = 0;
  for (const r of returns) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, 1 - equity / peak);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(returns.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, n - 1));
  return {
    days: n,
    totalPct: (equity - 1) * 100,
    annualPct: (Math.pow(equity, 365 / n) - 1) * 100,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(365) : 0,
    tStat: sd > 0 ? (mean / sd) * Math.sqrt(n) : 0,
    maxDrawdownPct: dd * 100,
  };
}
