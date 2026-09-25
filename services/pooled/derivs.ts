/**
 * Futures positioning data (open interest, long/short ratios, taker flow, funding) aligned to candles.
 *
 * Training reads it from the Binance public archive (data.binance.vision), live inference from the
 * collector's tables (market_metrics_5m, funding_rates). Both carry the same Binance series:
 *
 *   archive metrics                    collector column           Binance endpoint
 *   sum_open_interest                  open_interest              /openInterestHist
 *   count_long_short_ratio             global_ls_ratio            /globalLongShortAccountRatio
 *   sum_toptrader_long_short_ratio     top_ls_position_ratio      /topLongShortPositionRatio
 *   sum_taker_long_short_vol_ratio     taker_buy_sell_ratio       /takerlongshortRatio
 *   fundingRate.last_funding_rate      funding_rates.rate         /fundingRate
 */

import type { Candle } from "@/types";

/** One 5-minute snapshot. */
export interface DerivPoint {
  ts: number;
  oi?: number;
  lsGlobal?: number;
  lsTop?: number;
  taker?: number;
}

export interface DerivData {
  /** 5-minute snapshots, oldest first */
  points: DerivPoint[];
  /** Funding settlements, oldest first */
  funding: Array<{ time: number; rate: number }>;
}

export interface DerivBar {
  oi: number;
  lsGlobal: number;
  lsTop: number;
  taker: number;
  funding: number;
}

/** A snapshot this close to the bar's end may not be collected yet when the bar closes live. */
const SNAPSHOT_MARGIN_MS = 5 * 60_000;
/** A bar with no snapshot within this window before its end has no positioning data. */
const MAX_STALENESS_MS = 2 * 60 * 60_000;

/**
 * For every candle, the last snapshot taken at least SNAPSHOT_MARGIN_MS before the bar closed, and
 * the last funding rate settled by then. The same rule runs in training and live, so the model
 * never learns from a snapshot it would not have had at prediction time.
 */
export function alignDerivs(candles: Candle[], data: DerivData): Array<DerivBar | null> {
  const out: Array<DerivBar | null> = new Array(candles.length).fill(null);
  const pts = data.points;
  const fund = data.funding;
  let p = -1;
  let f = -1;
  // Carry the latest value of each series separately: one missing column must not blank the rest.
  const last: Partial<Record<keyof Omit<DerivPoint, "ts">, { v: number; ts: number }>> = {};
  for (let i = 0; i < candles.length; i++) {
    const cutoff = candles[i].closeTime + 1 - SNAPSHOT_MARGIN_MS;
    while (p + 1 < pts.length && pts[p + 1].ts <= cutoff) {
      p++;
      const s = pts[p];
      for (const k of ["oi", "lsGlobal", "lsTop", "taker"] as const) {
        const v = s[k];
        if (v !== undefined && Number.isFinite(v) && v > 0) last[k] = { v, ts: s.ts };
      }
    }
    while (f + 1 < fund.length && fund[f + 1].time <= candles[i].closeTime) f++;
    const fresh = (k: keyof typeof last) => {
      const e = last[k];
      return e && cutoff - e.ts <= MAX_STALENESS_MS ? e.v : undefined;
    };
    const oi = fresh("oi");
    const lsGlobal = fresh("lsGlobal");
    const lsTop = fresh("lsTop");
    const taker = fresh("taker");
    if (oi === undefined || lsGlobal === undefined || lsTop === undefined || taker === undefined || f < 0) continue;
    out[i] = { oi, lsGlobal, lsTop, taker, funding: fund[f].rate };
  }
  return out;
}
