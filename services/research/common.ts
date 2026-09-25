/**
 * Shared rules of the research runs: realistic execution (strategy-lab costs), one position per coin,
 * the best variant picked on the first 60% of the period and judged once on the last 40%.
 *
 * Many variants are tried, so the bar to pass is higher than the lab's: at least 30 holdout trades,
 * profit after costs on both periods and t ≥ 2 on the holdout.
 */

import type { Candle } from "@/types";
import { metricsOf, simulateBracket, type ExitKind, type LabMetrics } from "@/services/strategy-lab/lab";

export interface ResearchTrade {
  symbol: string;
  time: number;
  gross: number;
  exit: ExitKind;
}

/** A trade request: open at bar `index`'s close on `side`, stop and target distances in price. */
export interface TradeIntent {
  symbol: string;
  index: number;
  side: 1 | -1;
  slDist: number;
  tpDist: number;
  horizon: number;
}

/** Simulates intents in time order, skipping any that comes while the coin still has a position open. */
export function simulateIntents(intents: TradeIntent[], candlesBySymbol: Map<string, Candle[]>): ResearchTrade[] {
  const sorted = [...intents].sort((a, b) => candlesBySymbol.get(a.symbol)![a.index].openTime - candlesBySymbol.get(b.symbol)![b.index].openTime);
  const busyUntil = new Map<string, number>();
  const trades: ResearchTrade[] = [];
  for (const t of sorted) {
    const candles = candlesBySymbol.get(t.symbol)!;
    if ((busyUntil.get(t.symbol) ?? -1) >= t.index || t.index + 1 >= candles.length) continue;
    if (!(t.slDist > 0) || !(t.tpDist > 0)) continue;
    const { ret, exitIndex, exit } = simulateBracket(candles, t.index, t.side, t.tpDist, t.slDist, t.horizon);
    busyUntil.set(t.symbol, exitIndex);
    trades.push({ symbol: t.symbol, time: candles[t.index].openTime, gross: ret, exit });
  }
  return trades;
}

export interface Candidate {
  label: string;
  trades: ResearchTrade[];
}

export interface ResearchVerdict {
  name: string;
  tested: number;
  best: { label: string; selection: LabMetrics; holdout: LabMetrics; bySymbol: Record<string, LabMetrics> } | null;
  passed: boolean;
  reason: string;
}

export const MIN_SELECTION_TRADES = 30;
export const MIN_HOLDOUT_TRADES = 30;
export const MIN_HOLDOUT_T = 2;

export function selectAndValidate(name: string, candidates: Candidate[], from: number, to: number): ResearchVerdict {
  const split = from + (to - from) * 0.6;
  const selSpan = split - from;
  const holdSpan = to - split;
  let best: { c: Candidate; selection: LabMetrics } | null = null;
  for (const c of candidates) {
    const m = metricsOf(c.trades.filter((t) => t.time < split), selSpan);
    if (m.trades < MIN_SELECTION_TRADES) continue;
    if (!best || m.tStat > best.selection.tStat) best = { c, selection: m };
  }
  const verdict: ResearchVerdict = { name, tested: candidates.length, best: null, passed: false, reason: "" };
  if (!best) {
    verdict.reason = `ни один вариант не дал ${MIN_SELECTION_TRADES} сделок на периоде подбора`;
    return verdict;
  }
  const holdTrades = best.c.trades.filter((t) => t.time >= split);
  const holdout = metricsOf(holdTrades, holdSpan);
  const perSymbol = new Map<string, ResearchTrade[]>();
  for (const t of holdTrades) perSymbol.set(t.symbol, [...(perSymbol.get(t.symbol) ?? []), t]);
  const bySymbol = Object.fromEntries([...perSymbol].map(([s, tr]) => [s, metricsOf(tr, holdSpan)]));
  verdict.best = { label: best.c.label, selection: best.selection, holdout, bySymbol };

  const bp = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} п.`;
  if (best.selection.avgNetBp <= 0) verdict.reason = `даже лучший вариант убыточен после комиссий на подборе (${bp(best.selection.avgNetBp)} на сделку)`;
  else if (holdout.trades < MIN_HOLDOUT_TRADES) verdict.reason = `на проверке мало сделок (${holdout.trades})`;
  else if (holdout.avgNetBp <= 0) verdict.reason = `на проверке убыток: ${bp(holdout.avgNetBp)} на сделку`;
  else if (holdout.tStat < MIN_HOLDOUT_T) verdict.reason = `прибыль на проверке неотличима от случайности (t = ${holdout.tStat.toFixed(1)})`;
  else {
    verdict.passed = true;
    verdict.reason = `на проверке ${bp(holdout.avgNetBp)} на сделку после комиссий, ${holdout.trades} сделок, t = ${holdout.tStat.toFixed(1)}`;
  }
  return verdict;
}

export function describeVerdict(v: ResearchVerdict): string {
  const lines = [`${v.passed ? "✅" : "❌"} ${v.name} (${v.tested} вариантов): ${v.reason}`];
  if (v.best) {
    const { selection: a, holdout: b } = v.best;
    const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
    lines.push(
      `    лучший: ${v.best.label}`,
      `    подбор:   ${a.trades} сделок (${a.tradesPerWeek.toFixed(1)}/нед.), ${a.avgNetBp.toFixed(1)} п./сделку, в плюс ${pct(a.winRate)}, t=${a.tStat.toFixed(1)}`,
      `    проверка: ${b.trades} сделок (${b.tradesPerWeek.toFixed(1)}/нед.), ${b.avgNetBp.toFixed(1)} п./сделку, в плюс ${pct(b.winRate)}, t=${b.tStat.toFixed(1)}, просадка ${b.maxDrawdownPct.toFixed(1)}%`
    );
  }
  return lines.join("\n");
}
