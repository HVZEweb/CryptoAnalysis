/**
 * What actually happened after a prediction: did price end the horizon on the predicted side,
 * and which of TP / SL was touched first. Plus calibration: do "56%" calls win 56% of the time?
 */

import type { Candle, PredictionDirection } from "@/types";

export interface TradeOutcomeInput {
  direction: PredictionDirection;
  entry: number;
  tp?: number;
  sl?: number;
  /** Round-trip fee as a fraction of entry (e.g. 0.001 for 0.05% per side) */
  feeRoundTrip: number;
}

export interface TradeOutcome {
  closePrice: number;
  /** Close beyond entry on the predicted side; null for SIDEWAYS */
  directionHit: boolean | null;
  /** Which level was touched first; a candle touching both counts as SL (conservative) */
  firstHit: "tp" | "sl" | null;
  /** Result of trading the levels (exit at horizon close if neither was hit), after fees, % of entry */
  tradeReturnPct: number | null;
}

/** `candles` cover the prediction horizon, oldest first. */
export function evaluateTradeOutcome(input: TradeOutcomeInput, candles: Candle[]): TradeOutcome | null {
  if (!candles.length || !(input.entry > 0)) return null;
  const { direction, entry, tp, sl, feeRoundTrip } = input;
  const closePrice = candles[candles.length - 1].close;

  if (direction === "SIDEWAYS") {
    return { closePrice, directionHit: null, firstHit: null, tradeReturnPct: null };
  }

  const long = direction === "LONG";
  const directionHit = long ? closePrice > entry : closePrice < entry;

  let firstHit: TradeOutcome["firstHit"] = null;
  if (tp && sl) {
    for (const c of candles) {
      const slTouched = long ? c.low <= sl : c.high >= sl;
      const tpTouched = long ? c.high >= tp : c.low <= tp;
      if (slTouched) {
        firstHit = "sl";
        break;
      }
      if (tpTouched) {
        firstHit = "tp";
        break;
      }
    }
  }

  const exit = firstHit === "tp" ? tp! : firstHit === "sl" ? sl! : closePrice;
  const gross = long ? (exit - entry) / entry : (entry - exit) / entry;
  return {
    closePrice,
    directionHit,
    firstHit,
    tradeReturnPct: (gross - feeRoundTrip) * 100,
  };
}

export interface CalibrationBucket {
  label: string;
  /** Average stated probability of the calls in the bucket, % */
  stated: number;
  /** Share of those calls whose direction came true, % */
  actual: number;
  count: number;
}

const BUCKETS: Array<[number, number, string]> = [
  [50, 53, "50–53%"],
  [53, 56, "53–56%"],
  [56, 60, "56–60%"],
  [60, 101, "60%+"],
];

export function buildCalibration(calls: Array<{ probability: number; directionHit: boolean }>): CalibrationBucket[] {
  return BUCKETS.map(([lo, hi, label]) => {
    const inBucket = calls.filter((c) => c.probability >= lo && c.probability < hi);
    const count = inBucket.length;
    return {
      label,
      stated: count ? inBucket.reduce((s, c) => s + c.probability, 0) / count : (lo + Math.min(hi, 65)) / 2,
      actual: count ? (inBucket.filter((c) => c.directionHit).length / count) * 100 : 0,
      count,
    };
  });
}

/** Candle size fine enough to see which level was hit first, without thousands of requests. */
export function outcomeCandleInterval(durationMs: number): string {
  if (durationMs <= 4 * 3_600_000) return "1m";
  if (durationMs <= 24 * 3_600_000) return "5m";
  return "15m";
}
