/**
 * Candle-only features. The same function feeds training and live inference,
 * so a feature can never see data the model will not have at prediction time.
 * Everything is scaled by recent volatility, which lets one model serve all coins.
 */

import type { Candle } from "@/types";
import { FEATURE_LOOKBACK } from "@/services/predictor/config";

export const FEATURE_NAMES = [
  "ret_1",
  "ret_4",
  "ret_12",
  "ret_48",
  "vol_ratio",
  "rsi_14",
  "ema20_dist",
  "ema50_dist",
  "ema_cross",
  "range_pos_20",
  "volume_z",
  "candle_body",
  "taker_buy_4",
  "btc_ret_4",
  "btc_div_12",
] as const;

export const FEATURE_LABELS: Record<(typeof FEATURE_NAMES)[number], string> = {
  ret_1: "Движение последней свечи",
  ret_4: "Импульс 4 свечей",
  ret_12: "Импульс 12 свечей",
  ret_48: "Тренд 48 свечей",
  vol_ratio: "Рост/спад волатильности",
  rsi_14: "RSI 14",
  ema20_dist: "Отклонение от EMA20",
  ema50_dist: "Отклонение от EMA50",
  ema_cross: "EMA20 vs EMA50",
  range_pos_20: "Позиция в диапазоне 20 свечей",
  volume_z: "Аномалия объёма",
  candle_body: "Тело последней свечи",
  taker_buy_4: "Доля рыночных покупок (4 свечи)",
  btc_ret_4: "Импульс BTC (4 свечи)",
  btc_div_12: "Отставание от BTC (12 свечей)",
};

const CLIP = 6;

function clip(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-CLIP, Math.min(CLIP, v));
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out = new Array<number>(values.length);
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(closes: number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(50);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = Math.max(diff, 0);
    const loss = Math.max(-diff, 0);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (i >= period) {
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

/** Rolling standard deviation of `values` over the window ending at i (inclusive). */
function rollingStd(values: number[], window: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    sumSq += values[i] * values[i];
    if (i >= window) {
      sum -= values[i - window];
      sumSq -= values[i - window] * values[i - window];
    }
    if (i >= window - 1) {
      const mean = sum / window;
      out[i] = Math.sqrt(Math.max(sumSq / window - mean * mean, 0));
    }
  }
  return out;
}

export interface FeatureSeries {
  /** Feature vector per candle index, null while the lookback is not filled. */
  rows: Array<number[] | null>;
  /** Per-bar volatility (std of 1-bar log returns, 24 bars) — the unit for price ranges. */
  vol: number[];
}

export interface FeatureContext {
  /** BTC candles of the same interval — the market leader's move as a signal for every coin */
  btc?: Candle[];
}

/** Normalised k-bar return for each index (NaN until enough history). */
function normalisedReturns(candles: Candle[], bars: number): number[] {
  const closes = candles.map((c) => c.close);
  const logRet = closes.map((c, i) => (i === 0 ? 0 : Math.log(c / closes[i - 1])));
  const vol = rollingStd(logRet, 24);
  const out = new Array<number>(candles.length).fill(NaN);
  for (let i = bars; i < candles.length; i++) {
    if (vol[i] > 0) out[i] = Math.log(closes[i] / closes[i - bars]) / (vol[i] * Math.sqrt(bars));
  }
  return out;
}

export function computeFeatureSeries(candles: Candle[], context: FeatureContext = {}): FeatureSeries {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const logRet = closes.map((c, i) => (i === 0 ? 0 : Math.log(c / closes[i - 1])));
  const vol24 = rollingStd(logRet, 24);
  const vol96 = rollingStd(logRet, 96);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const logVolume = candles.map((c) => Math.log(1 + Math.max(c.quoteVolume || c.volume * c.close, 0)));
  const volumeStd = rollingStd(logVolume, 20);

  const cumRet: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) cumRet[i] = cumRet[i - 1] + logRet[i];
  const retOver = (i: number, bars: number) => cumRet[i] - cumRet[i - bars];

  // BTC features are looked up by bar open time, so a BTC bar is only ever paired with the same bar.
  const btcRet4 = new Map<number, number>();
  const btcRet12 = new Map<number, number>();
  if (context.btc?.length) {
    const r4 = normalisedReturns(context.btc, 4);
    const r12 = normalisedReturns(context.btc, 12);
    context.btc.forEach((c, i) => {
      if (Number.isFinite(r4[i])) btcRet4.set(c.openTime, r4[i]);
      if (Number.isFinite(r12[i])) btcRet12.set(c.openTime, r12[i]);
    });
  }

  const rows: Array<number[] | null> = new Array(n).fill(null);
  for (let i = FEATURE_LOOKBACK; i < n; i++) {
    const v = vol24[i];
    if (!(v > 0)) continue;

    let hi = -Infinity;
    let lo = Infinity;
    let volumeSum = 0;
    for (let j = i - 19; j <= i; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
      volumeSum += logVolume[j];
    }
    const volumeMean = volumeSum / 20;
    const c = candles[i];
    const barRange = c.high - c.low;

    let takerBuy = 0;
    let takerVolume = 0;
    let takerKnown = true;
    for (let j = i - 3; j <= i; j++) {
      const t = candles[j].takerBuyVolume;
      if (t === undefined || !(candles[j].volume > 0)) {
        takerKnown = false;
        break;
      }
      takerBuy += t;
      takerVolume += candles[j].volume;
    }

    const ret12 = retOver(i, 12) / (v * Math.sqrt(12));
    const btc12 = btcRet12.get(c.openTime);

    rows[i] = [
      logRet[i] / v,
      retOver(i, 4) / (v * 2),
      ret12,
      retOver(i, 48) / (v * Math.sqrt(48)),
      Math.log(v / vol96[i]),
      (rsi14[i] - 50) / 25,
      Math.log(c.close / ema20[i]) / (v * Math.sqrt(20)),
      Math.log(c.close / ema50[i]) / (v * Math.sqrt(50)),
      Math.log(ema20[i] / ema50[i]) / (v * Math.sqrt(50)),
      hi > lo ? ((c.close - lo) / (hi - lo) - 0.5) * 2 : 0,
      volumeStd[i] > 0 ? (logVolume[i] - volumeMean) / volumeStd[i] : 0,
      barRange > 0 ? (c.close - c.open) / barRange : 0,
      takerKnown && takerVolume > 0 ? (takerBuy / takerVolume - 0.5) * 10 : 0,
      btcRet4.get(c.openTime) ?? 0,
      btc12 !== undefined ? btc12 - ret12 : 0,
    ].map(clip);
  }

  return { rows, vol: vol24 };
}
