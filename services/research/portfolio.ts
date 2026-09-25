/**
 * Daily portfolio backtest for slow strategies (trend following, cross-sectional ranks), where a
 * position is held while its signal lasts instead of a fixed TP/SL bracket.
 *
 * Each day, after the close, a strategy sets target weights (signed fractions of equity, gross ≤ 1).
 * The change is traded at that close with market orders (taker fee + slippage per unit of turnover);
 * the next day earns w × (close-to-close return) and pays or receives funding on w (longs pay when
 * funding is positive). Results are judged like the other research runs: the variant is picked on the
 * first 60% of days, then judged once on the last 40% — profit, t ≥ 2 — and set against simply
 * holding BTC and an equal-weight basket.
 */

import type { Candle } from "@/types";
import { LAB_EXECUTION } from "@/services/strategy-lab/lab";

const DAY = 86_400_000;
/** Market order per side: taker fee + slippage */
export const REBALANCE_COST = LAB_EXECUTION.takerFee + LAB_EXECUTION.slippage;

export interface DailyUniverse {
  /** UTC day start times, oldest first — the union of all coins' days */
  days: number[];
  symbols: string[];
  /** close[s][d], NaN when the coin had no bar that day (not listed yet) */
  close: number[][];
  /** Sum of funding rates settled during day d (UTC), 0 when unknown */
  funding: number[][];
}

export function buildUniverse(
  series: Array<{ symbol: string; candles: Candle[]; funding: Array<{ time: number; rate: number }> }>
): DailyUniverse {
  const daySet = new Set<number>();
  for (const s of series) for (const c of s.candles) daySet.add(c.openTime - (c.openTime % DAY));
  const days = [...daySet].sort((a, b) => a - b);
  const index = new Map(days.map((d, i) => [d, i]));
  const close = series.map((s) => {
    const row = new Array<number>(days.length).fill(NaN);
    for (const c of s.candles) row[index.get(c.openTime - (c.openTime % DAY))!] = c.close;
    return row;
  });
  const funding = series.map((s) => {
    const row = new Array<number>(days.length).fill(0);
    for (const f of s.funding) {
      const i = index.get(f.time - (f.time % DAY));
      if (i !== undefined) row[i] += f.rate;
    }
    return row;
  });
  return { days, symbols: series.map((s) => s.symbol), close, funding };
}

/** A strategy: target weights per coin after day d's close (only coins with a close that day). */
export type Strategy = (u: DailyUniverse, d: number, prev: number[]) => number[];

export interface PortfolioRun {
  /** Net daily returns, index aligned with u.days (0 before the strategy starts) */
  returns: number[];
  /** First day with a position */
  start: number;
  turnover: number;
  costs: number;
  funding: number;
  /** Average gross exposure while running */
  exposure: number;
}

export function runStrategy(u: DailyUniverse, strategy: Strategy): PortfolioRun {
  const n = u.symbols.length;
  let w = new Array<number>(n).fill(0);
  const returns = new Array<number>(u.days.length).fill(0);
  let start = -1;
  let turnover = 0;
  let costs = 0;
  let funding = 0;
  let exposureSum = 0;
  let exposureDays = 0;
  for (let d = 0; d < u.days.length - 1; d++) {
    const target = strategy(u, d, w).map((x, s) => (Number.isFinite(u.close[s][d]) && Number.isFinite(x) ? x : 0));
    const traded = target.reduce((sum, x, s) => sum + Math.abs(x - w[s]), 0);
    w = target;
    const gross = w.reduce((s, x) => s + Math.abs(x), 0);
    if (gross > 0 && start < 0) start = d + 1;
    let r = -traded * REBALANCE_COST;
    costs += traded * REBALANCE_COST;
    turnover += traded;
    for (let s = 0; s < n; s++) {
      if (!w[s]) continue;
      const c0 = u.close[s][d];
      const c1 = u.close[s][d + 1];
      if (!(c0 > 0) || !(c1 > 0)) continue;
      r += w[s] * (c1 / c0 - 1);
      const f = w[s] * u.funding[s][d + 1];
      r -= f;
      funding -= f;
    }
    returns[d + 1] += r;
    if (gross > 0) {
      exposureSum += gross;
      exposureDays++;
    }
  }
  return { returns, start: Math.max(start, 0), turnover, costs, funding, exposure: exposureDays ? exposureSum / exposureDays : 0 };
}

export interface PeriodStats {
  days: number;
  annualReturnPct: number;
  annualVolPct: number;
  sharpe: number;
  /** mean / standard error of daily returns */
  tStat: number;
  maxDrawdownPct: number;
  totalPct: number;
}

export function periodStats(returns: number[]): PeriodStats {
  const n = returns.length;
  if (!n) return { days: 0, annualReturnPct: 0, annualVolPct: 0, sharpe: 0, tStat: 0, maxDrawdownPct: 0, totalPct: 0 };
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(returns.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, n - 1));
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  for (const r of returns) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, 1 - equity / peak);
  }
  return {
    days: n,
    annualReturnPct: (Math.pow(equity, 365 / n) - 1) * 100,
    annualVolPct: sd * Math.sqrt(365) * 100,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(365) : 0,
    tStat: sd > 0 ? (mean / sd) * Math.sqrt(n) : 0,
    maxDrawdownPct: maxDd * 100,
    totalPct: (equity - 1) * 100,
  };
}

// --- Strategies --------------------------------------------------------------------------------

/** Annualised volatility of daily returns over `window` days ending at d (NaN without enough data). */
export function annualVol(closes: number[], d: number, window: number): number {
  const r: number[] = [];
  for (let i = d - window + 1; i <= d; i++) {
    if (i < 1 || !(closes[i] > 0) || !(closes[i - 1] > 0)) return NaN;
    r.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, x) => a + (x - mean) ** 2, 0) / (r.length - 1)) * Math.sqrt(365);
}

export const DONCHIAN_LOOKBACKS = [5, 10, 20, 30, 60, 90, 150, 250, 360];

/**
 * Trend following: an ensemble of Donchian breakouts. For each lookback N the coin goes long when the
 * close exceeds the highest close of the previous N days and exits when it falls below the lowest close
 * of the previous N/2 days (shorts mirror it). The coin's signal is the average over the lookbacks;
 * its weight is that signal × a volatility target (25% a year per coin), split equally across coins.
 */
export function trendStrategy(allowShort: boolean, targetVol = 0.25): Strategy {
  // Breakout states per coin and lookback persist from day to day.
  const states = new Map<string, number[]>();
  return (u, d) => {
    const live = u.symbols.map((_, s) => u.close[s][d] > 0);
    const liveCount = live.filter(Boolean).length || 1;
    return u.symbols.map((symbol, s) => {
      if (!live[s]) return 0;
      const closes = u.close[s];
      const st = states.get(symbol) ?? DONCHIAN_LOOKBACKS.map(() => 0);
      DONCHIAN_LOOKBACKS.forEach((N, k) => {
        const half = Math.max(2, Math.floor(N / 2));
        if (d - N < 0 || !(closes[d - N] > 0)) return;
        let hi = -Infinity;
        let lo = Infinity;
        for (let i = d - N; i < d; i++) (hi = Math.max(hi, closes[i])), (lo = Math.min(lo, closes[i]));
        let hiHalf = -Infinity;
        let loHalf = Infinity;
        for (let i = d - half; i < d; i++) (hiHalf = Math.max(hiHalf, closes[i])), (loHalf = Math.min(loHalf, closes[i]));
        const c = closes[d];
        if (st[k] === 0) {
          if (c > hi) st[k] = 1;
          else if (allowShort && c < lo) st[k] = -1;
        } else if (st[k] === 1 && c < loHalf) st[k] = allowShort && c < lo ? -1 : 0;
        else if (st[k] === -1 && c > hiHalf) st[k] = c > hi ? 1 : 0;
      });
      states.set(symbol, st);
      const signal = st.reduce((a, b) => a + b, 0) / st.length;
      const vol = annualVol(closes, d, 30);
      if (!signal || !(vol > 0)) return 0;
      return (signal * Math.min(1, targetVol / vol)) / liveCount;
    });
  };
}

/**
 * Cross-sectional ranking, rebalanced when `isRebalanceDay` says so: long the lowest third by
 * `score`, short the highest third, equal weights, gross 1 (market-neutral). Coins without a score
 * that day are left out.
 */
export function rankStrategy(score: (u: DailyUniverse, s: number, d: number) => number, isRebalanceDay: (day: number) => boolean): Strategy {
  return (u, d, prev) => {
    if (!isRebalanceDay(u.days[d]) && prev.some((x) => x !== 0)) return prev;
    const ranked = u.symbols
      .map((_, s) => ({ s, v: u.close[s][d] > 0 ? score(u, s, d) : NaN }))
      .filter((x) => Number.isFinite(x.v))
      .sort((a, b) => a.v - b.v);
    const w = new Array<number>(u.symbols.length).fill(0);
    const k = Math.floor(ranked.length / 3);
    if (k < 2) return w;
    for (const { s } of ranked.slice(0, k)) w[s] = 0.5 / k;
    for (const { s } of ranked.slice(-k)) w[s] = -0.5 / k;
    return w;
  };
}

/** Low volatility: long the calmest third, short the most volatile, monthly. */
export function lowVolStrategy(window: number): Strategy {
  return rankStrategy((u, s, d) => annualVol(u.close[s], d, window), (day) => new Date(day).getUTCDate() === 1);
}

/** Funding carry across perpetuals: long the lowest average funding, short the highest, weekly. */
export function fundingStrategy(window: number): Strategy {
  return rankStrategy(
    (u, s, d) => {
      if (d - window + 1 < 0 || !(u.close[s][d - window + 1] > 0)) return NaN;
      let sum = 0;
      for (let i = d - window + 1; i <= d; i++) sum += u.funding[s][i];
      return sum / window;
    },
    (day) => new Date(day).getUTCDay() === 1
  );
}

/** Buy and hold one coin (the BTC benchmark). */
export function holdStrategy(symbol: string): Strategy {
  return (u) => u.symbols.map((s) => (s === symbol ? 1 : 0));
}

/** Equal weight across every listed coin, rebalanced monthly — the "just be in crypto" benchmark. */
export function basketStrategy(): Strategy {
  return (u, d, prev) => {
    if (new Date(u.days[d]).getUTCDate() !== 1 && prev.some((x) => x !== 0)) return prev;
    const live = u.symbols.map((_, s) => u.close[s][d] > 0);
    const n = live.filter(Boolean).length;
    return live.map((l) => (l && n ? 1 / n : 0));
  };
}

// --- Study -------------------------------------------------------------------------------------

export interface PortfolioVariant {
  label: string;
  strategy: () => Strategy;
}

export interface PortfolioVerdict {
  name: string;
  variants: Array<{ label: string; selection: PeriodStats; holdout: PeriodStats; turnoverPerYear: number; costsPctPerYear: number; fundingPctPerYear: number; exposure: number }>;
  best: string | null;
  passed: boolean;
  reason: string;
}

export const MIN_HOLDOUT_T_PORTFOLIO = 2;

/** Days from `start` split 60/40; the variant with the best selection Sharpe is judged on the rest. */
export function studyPortfolio(name: string, u: DailyUniverse, variants: PortfolioVariant[], split: number): PortfolioVerdict {
  const rows = variants.map((v) => {
    const run = runStrategy(u, v.strategy());
    const years = (u.days.length - run.start) / 365 || 1;
    return {
      label: v.label,
      selection: periodStats(run.returns.slice(run.start, split)),
      holdout: periodStats(run.returns.slice(split)),
      turnoverPerYear: run.turnover / years,
      costsPctPerYear: (run.costs / years) * 100,
      fundingPctPerYear: (run.funding / years) * 100,
      exposure: run.exposure,
    };
  });
  const best = rows.reduce<(typeof rows)[number] | null>((a, r) => (!a || r.selection.sharpe > a.selection.sharpe ? r : a), null);
  const verdict: PortfolioVerdict = { name, variants: rows, best: best?.label ?? null, passed: false, reason: "" };
  if (!best) return { ...verdict, reason: "нет вариантов" };
  const h = best.holdout;
  if (best.selection.annualReturnPct <= 0) verdict.reason = `лучший вариант убыточен уже на подборе (${best.selection.annualReturnPct.toFixed(1)}% годовых)`;
  else if (h.annualReturnPct <= 0) verdict.reason = `на проверке убыток: ${h.annualReturnPct.toFixed(1)}% годовых`;
  else if (h.tStat < MIN_HOLDOUT_T_PORTFOLIO) verdict.reason = `на проверке ${h.annualReturnPct.toFixed(1)}% годовых, но это неотличимо от случайности (t = ${h.tStat.toFixed(1)})`;
  else {
    verdict.passed = true;
    verdict.reason = `на проверке ${h.annualReturnPct.toFixed(1)}% годовых, Sharpe ${h.sharpe.toFixed(2)}, t = ${h.tStat.toFixed(1)}, просадка ${h.maxDrawdownPct.toFixed(0)}%`;
  }
  return verdict;
}

export function describePortfolio(v: PortfolioVerdict): string {
  const f = (s: PeriodStats) =>
    `${s.annualReturnPct >= 0 ? "+" : ""}${s.annualReturnPct.toFixed(1)}%/год, Sharpe ${s.sharpe.toFixed(2)}, t=${s.tStat.toFixed(1)}, просадка ${s.maxDrawdownPct.toFixed(0)}%`;
  return [
    `${v.passed ? "✅" : "❌"} ${v.name}: ${v.reason}`,
    ...v.variants.map(
      (r) =>
        `    ${r.label === v.best ? "▶" : " "} ${r.label}\n` +
        `        подбор:   ${f(r.selection)}\n` +
        `        проверка: ${f(r.holdout)}\n` +
        `        оборот ${r.turnoverPerYear.toFixed(1)}×/год, комиссии ${r.costsPctPerYear.toFixed(1)}%/год, фандинг ${r.fundingPctPerYear >= 0 ? "+" : ""}${r.fundingPctPerYear.toFixed(1)}%/год, средняя загрузка ${(r.exposure * 100).toFixed(0)}%`
    ),
  ].join("\n");
}

export { DAY };
