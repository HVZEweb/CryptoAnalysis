/**
 * Pure rules of the Telegram signals: which coin a model may signal on, how an open signal ends,
 * the live track record, and when a model is switched off because live results fell short.
 */

import type { Candle } from "@/types";
import type { PredictorModel } from "@/services/predictor";
import { LAB_FEES } from "@/services/strategy-lab/lab";
import type { SignalRow } from "@/services/signals/store";

/** "sol", "SOL", "solusdt", "$SOL" → "SOLUSDT" */
export function normalizeSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/^\$/, "").replace(/[/\-_]?USDT$/, "");
  return /^[A-Z0-9]{2,15}$/.test(s) ? `${s}USDT` : null;
}

export function parseCommand(text: string): { cmd: string; args: string[] } | null {
  const m = /^\/([a-z_]+)(?:@\w+)?\s*(.*)$/i.exec(text.trim());
  if (!m) return null;
  return { cmd: m[1].toLowerCase(), args: m[2].split(/[\s,]+/).filter(Boolean) };
}

/** Minimum holdout trades on a coin before its own result is trusted as "paid on this coin". */
export const MIN_COIN_TRADES = 10;

export interface CoinVerdict {
  ok: boolean;
  /** One line for /list */
  text: string;
}

/**
 * A model may signal on a coin only when its setup made money after fees on history it was not
 * tuned on — overall, and on that coin too when the model has per-coin results.
 */
export function coinVerdict(model: PredictorModel, symbol: string): CoinVerdict {
  const s = model.strategy;
  if (!model.symbols.includes(symbol)) return { ok: false, text: "модель не обучалась на этой монете" };
  if (!s) return { ok: false, text: "стратегия не проверялась" };
  if (!s.profitable || !s.best) return { ok: false, text: `нет прибыльной настройки (${s.reason})` };
  const coin = s.bySymbol?.[symbol];
  if (s.bySymbol) {
    if (!coin || coin.trades < MIN_COIN_TRADES) return { ok: false, text: `на этой монете мало проверочных сделок (${coin?.trades ?? 0})` };
    if (coin.avgNetBp <= 0) return { ok: false, text: `на этой монете в минусе: ${coin.avgNetBp.toFixed(1)} п./сделку` };
    return { ok: true, text: `проверено: +${coin.avgNetBp.toFixed(1)} п./сделку на ${coin.trades} сделках, в плюс ${(coin.winRate * 100).toFixed(0)}%` };
  }
  return { ok: true, text: `проверено в целом: +${s.best.holdout.avgNetBp.toFixed(1)} п./сделку` };
}

export interface Outcome {
  status: "tp" | "sl" | "timeout";
  exitPrice: number;
  exitTime: number;
  grossBp: number;
  netBp: number;
}

/**
 * How an open signal ended, by the strategy lab's rules: entry at the signal bar's close, stop wins
 * when a candle touches both levels, otherwise exit at the close of the last bar by `close_by`.
 * `candles` are closed bars of the signal's interval. Null while the signal is still running.
 */
export function evaluateOutcome(signal: Pick<SignalRow, "side" | "entry" | "tp" | "sl" | "entry_time" | "close_by">, candles: Candle[]): Outcome | null {
  const long = signal.side === "LONG";
  const bars = candles.filter((c) => c.openTime >= signal.entry_time).sort((a, b) => a.openTime - b.openTime);
  const result = (status: Outcome["status"], exitPrice: number, exitTime: number): Outcome => {
    const gross = ((long ? 1 : -1) * (exitPrice - signal.entry)) / signal.entry;
    return { status, exitPrice, exitTime, grossBp: gross * 1e4, netBp: (gross - LAB_FEES.maker) * 1e4 };
  };
  for (const c of bars) {
    if (c.closeTime > signal.close_by) break;
    const slHit = long ? c.low <= signal.sl : c.high >= signal.sl;
    const tpHit = long ? c.high >= signal.tp : c.low <= signal.tp;
    if (slHit) return result("sl", signal.sl, c.closeTime);
    if (tpHit) return result("tp", signal.tp, c.closeTime);
  }
  const last = bars.filter((c) => c.closeTime <= signal.close_by).at(-1);
  if (last && last.closeTime + 1 >= signal.close_by) return result("timeout", last.close, last.closeTime);
  return null;
}

export interface TrackRecord {
  closed: number;
  wins: number;
  avgNetBp: number;
  sumNetPct: number;
}

export function trackRecord(rows: Array<Pick<SignalRow, "net_bp">>): TrackRecord {
  const net = rows.map((r) => r.net_bp ?? 0);
  const sum = net.reduce((a, b) => a + b, 0);
  return { closed: net.length, wins: net.filter((v) => v > 0).length, avgNetBp: net.length ? sum / net.length : 0, sumNetPct: sum / 100 };
}

/** Live signals of one model version needed before its live result can switch it off. */
export const DISABLE_AFTER = 30;

/** Switch a model off when its live signals lost money on average after fees. */
export function disableReason(rows: Array<Pick<SignalRow, "net_bp">>): string | null {
  if (rows.length < DISABLE_AFTER) return null;
  const r = trackRecord(rows);
  if (r.avgNetBp >= 0) return null;
  return `после ${r.closed} реальных сигналов в среднем ${r.avgNetBp.toFixed(1)} п. на сделку после комиссий — хуже, чем на проверке`;
}

export function formatTrackRecord(title: string, r: TrackRecord): string {
  if (!r.closed) return `${title}: закрытых сигналов пока нет`;
  const sign = (v: number) => (v >= 0 ? "+" : "");
  return (
    `${title}: ${r.closed} сигналов, в плюс ${r.wins} (${Math.round((r.wins / r.closed) * 100)}%), ` +
    `в среднем ${sign(r.avgNetBp)}${r.avgNetBp.toFixed(1)} п., всего ${sign(r.sumNetPct)}${r.sumNetPct.toFixed(2)}% после комиссий`
  );
}
