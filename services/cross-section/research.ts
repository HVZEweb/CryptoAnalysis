/**
 * Cross-sectional research: instead of guessing where one coin goes, rank 30–50 coins against each
 * other and hold a market-neutral book — long the top fifth, short the bottom fifth — rebalanced on a
 * fixed schedule. Momentum (buy recent winners) and reversal (buy recent losers) are tested over
 * several lookbacks and holding periods, with exchange fees on every rebalance.
 *
 * The setup is chosen on the first half of history and judged only on the second half.
 */

import fs from "fs";
import path from "path";
import type { Candle } from "@/types";

const DAY = 86_400_000;

/** Binance futures fee per side, as a fraction of the notional traded. */
export const XS_FEES = { maker: 0.0002, taker: 0.0005 } as const;

export interface XsSetup {
  mode: "momentum" | "reversal";
  /** Days of past return the coins are ranked by */
  lookback: number;
  /** Days between rebalances (= holding period) */
  hold: number;
}

export interface XsMetrics {
  periods: number;
  /** Mean net return of the book per holding period, basis points (maker fees) */
  avgNetBp: number;
  avgNetBpTaker: number;
  /** Mean share of the book traded per rebalance (1 = the whole book replaced) */
  avgTurnover: number;
  winRate: number;
  tStat: number;
  sharpe: number;
  annualPct: number;
  maxDrawdownPct: number;
}

export interface XsReport {
  evaluatedAt: string;
  symbols: string[];
  dataFrom: string;
  dataTo: string;
  fees: typeof XS_FEES;
  setupsTested: number;
  selectionPeriod: { from: string; to: string };
  holdoutPeriod: { from: string; to: string };
  best: { setup: XsSetup; selection: XsMetrics; holdout: XsMetrics } | null;
  /** Top setups by the selection period, with how they did afterwards — to see whether ranking held */
  leaders: Array<{ setup: XsSetup; selection: XsMetrics; holdout: XsMetrics }>;
  profitable: boolean;
  reason: string;
  caveats: string[];
}

interface Period {
  start: number;
  gross: number;
  turnover: number;
}

/** Daily closes on a shared calendar; NaN where a coin has no bar (not listed yet, or delisted). */
export function alignCloses(series: Map<string, Candle[]>): { days: number[]; symbols: string[]; closes: number[][] } {
  let first = Infinity;
  let last = -Infinity;
  for (const candles of series.values()) {
    for (const c of candles) {
      const d = Math.floor(c.openTime / DAY);
      first = Math.min(first, d);
      last = Math.max(last, d);
    }
  }
  const symbols = [...series.keys()];
  if (!Number.isFinite(first)) return { days: [], symbols, closes: symbols.map(() => []) };
  const days = Array.from({ length: last - first + 1 }, (_, i) => (first + i) * DAY);
  const closes = symbols.map((s) => {
    const row = new Array<number>(days.length).fill(NaN);
    for (const c of series.get(s)!) row[Math.floor(c.openTime / DAY) - first] = c.close;
    return row;
  });
  return { days, symbols, closes };
}

const MIN_COINS = 10;

/** Simulates one setup over the whole calendar. Each period starts at a day's close. */
export function runXsSetup(closes: number[][], setup: XsSetup, startDay = 0): Period[] {
  const nDays = closes[0]?.length ?? 0;
  const periods: Period[] = [];
  let prev = new Map<number, number>();
  for (let d = Math.max(startDay, setup.lookback); d + 1 < nDays; d += setup.hold) {
    const end = Math.min(d + setup.hold, nDays - 1);
    const ranked: Array<{ i: number; signal: number; ret: number }> = [];
    for (let i = 0; i < closes.length; i++) {
      const now = closes[i][d];
      const past = closes[i][d - setup.lookback];
      if (!(now > 0) || !(past > 0)) continue;
      // A coin delisted during the hold exits at its last close.
      let exit = NaN;
      for (let j = end; j > d && !(exit > 0); j--) exit = closes[i][j];
      if (!(exit > 0)) continue;
      ranked.push({ i, signal: now / past - 1, ret: exit / now - 1 });
    }
    if (ranked.length < MIN_COINS) {
      prev = new Map();
      continue;
    }
    ranked.sort((a, b) => b.signal - a.signal);
    const q = Math.max(2, Math.floor(ranked.length / 5));
    const winners = ranked.slice(0, q);
    const losers = ranked.slice(-q);
    const [longs, shorts] = setup.mode === "momentum" ? [winners, losers] : [losers, winners];

    const weights = new Map<number, number>();
    for (const c of longs) weights.set(c.i, 0.5 / q);
    for (const c of shorts) weights.set(c.i, -0.5 / q);
    let turnover = 0;
    for (const k of new Set([...weights.keys(), ...prev.keys()])) turnover += Math.abs((weights.get(k) ?? 0) - (prev.get(k) ?? 0));
    const gross = [...longs, ...shorts].reduce((s, c) => s + (weights.get(c.i) ?? 0) * c.ret, 0);
    periods.push({ start: d, gross, turnover });
    prev = weights;
  }
  return periods;
}

export function xsMetrics(periods: Period[], hold: number): XsMetrics {
  const n = periods.length;
  if (!n) {
    return { periods: 0, avgNetBp: 0, avgNetBpTaker: 0, avgTurnover: 0, winRate: 0, tStat: 0, sharpe: 0, annualPct: 0, maxDrawdownPct: 0 };
  }
  const net = periods.map((p) => p.gross - p.turnover * XS_FEES.maker);
  const mean = net.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(net.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1));
  const avgTurnover = periods.reduce((s, p) => s + p.turnover, 0) / n;
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of net) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  const perYear = 365 / hold;
  return {
    periods: n,
    avgNetBp: mean * 1e4,
    avgNetBpTaker: (mean - avgTurnover * (XS_FEES.taker - XS_FEES.maker)) * 1e4,
    avgTurnover,
    winRate: net.filter((v) => v > 0).length / n,
    tStat: sd > 0 ? (mean / sd) * Math.sqrt(n) : 0,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(perYear) : 0,
    annualPct: mean * perYear * 100,
    maxDrawdownPct: maxDd * 100,
  };
}

export function xsGrid(): XsSetup[] {
  const grid: XsSetup[] = [];
  for (const mode of ["momentum", "reversal"] as const)
    for (const lookback of [1, 3, 7, 14, 30, 60])
      for (const hold of [1, 3, 7, 14]) grid.push({ mode, lookback, hold });
  return grid;
}

const MIN_PERIODS = 20;
const MIN_HOLDOUT_T = 1.5;

export function evaluateCrossSection(series: Map<string, Candle[]>, grid: XsSetup[] = xsGrid()): XsReport {
  const { days, symbols, closes } = alignCloses(series);
  const iso = (d: number) => new Date(days[Math.min(d, days.length - 1)] ?? 0).toISOString();
  const report: XsReport = {
    evaluatedAt: new Date().toISOString(),
    symbols,
    dataFrom: days.length ? iso(0) : "",
    dataTo: days.length ? iso(days.length - 1) : "",
    fees: XS_FEES,
    setupsTested: grid.length,
    selectionPeriod: { from: "", to: "" },
    holdoutPeriod: { from: "", to: "" },
    best: null,
    leaders: [],
    profitable: false,
    reason: "",
    caveats: [
      "Монеты взяты из сегодняшнего топа по обороту: монеты, которые за эти годы упали и ушли из топа, в выборку не попали, поэтому прошлое выглядит лучше, чем было.",
      "Фандинг не учтён: в книге лонг/шорт он частично взаимно гасится, но при сильном перекосе рынка может съесть часть результата.",
    ],
  };
  if (days.length < 200 || symbols.length < MIN_COINS) {
    report.reason = "мало данных: нужно хотя бы 200 дней и 10 монет";
    return report;
  }

  const split = Math.floor(days.length / 2);
  report.selectionPeriod = { from: iso(0), to: iso(split) };
  report.holdoutPeriod = { from: iso(split), to: iso(days.length - 1) };

  const results = grid.map((setup) => {
    const periods = runXsSetup(closes, setup);
    return {
      setup,
      // A holding period that spans the split belongs to the selection half; the holdout starts clean.
      selection: xsMetrics(periods.filter((p) => p.start + setup.hold <= split), setup.hold),
      holdout: xsMetrics(periods.filter((p) => p.start >= split), setup.hold),
    };
  });
  const ranked = results.filter((r) => r.selection.periods >= MIN_PERIODS).sort((a, b) => b.selection.sharpe - a.selection.sharpe);
  report.leaders = ranked.slice(0, 5);
  const best = ranked[0];
  if (!best) {
    report.reason = "ни одна настройка не набрала достаточно периодов";
    return report;
  }
  report.best = best;
  const h = best.holdout;
  const label = `${best.setup.mode === "momentum" ? "импульс" : "разворот"} ${best.setup.lookback} д., держать ${best.setup.hold} д.`;
  if (best.selection.avgNetBp <= 0) {
    report.reason = `даже лучшая из ${grid.length} настроек (${label}) убыточна после комиссий`;
  } else if (h.periods < MIN_PERIODS) {
    report.reason = `на проверочной половине слишком мало периодов (${h.periods})`;
  } else if (h.avgNetBp <= 0) {
    report.reason = `${label}: прибыль не подтвердилась на второй половине истории (${h.annualPct.toFixed(1)}% годовых)`;
  } else if (h.tStat < MIN_HOLDOUT_T) {
    report.reason = `${label}: на второй половине ${h.annualPct.toFixed(1)}% годовых, но это неотличимо от случайности (t = ${h.tStat.toFixed(1)})`;
  } else {
    report.profitable = true;
    report.reason = `${label}: на второй половине +${h.annualPct.toFixed(1)}% годовых после комиссий, Sharpe ${h.sharpe.toFixed(2)}, t = ${h.tStat.toFixed(1)}`;
  }
  return report;
}

/** Stored next to the models: that directory is writable by the service and survives deploys. */
export function reportPath(): string {
  const dir = process.env.PREDICTOR_MODELS_DIR?.trim() || path.join(process.cwd(), ".cache");
  return path.join(dir, "cross-section.json");
}

export function saveXsReport(report: XsReport): string {
  const file = reportPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  return file;
}

export function loadXsReport(): XsReport | null {
  try {
    return JSON.parse(fs.readFileSync(reportPath(), "utf-8")) as XsReport;
  } catch {
    return null;
  }
}
