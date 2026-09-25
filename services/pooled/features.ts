/**
 * Features of the pooled model: the candle features every model uses plus futures positioning.
 * Positioning is normalised per coin (changes in units of their own recent spread, levels as
 * z-scores over the last week of bars), so one model can serve many coins.
 */

import type { Candle } from "@/types";
import { computeFeatureSeries, FEATURE_LABELS, FEATURE_NAMES, type FeatureContext, type FeatureSeries } from "@/services/predictor/features";
import { alignDerivs, type DerivData } from "@/services/pooled/derivs";

export const DERIV_FEATURE_NAMES = [
  "oi_chg_1",
  "oi_chg_24",
  "oi_x_price",
  "ls_global_z",
  "ls_global_chg_24",
  "ls_top_z",
  "taker_z",
  "funding",
  "funding_z",
] as const;

export const POOLED_FEATURE_NAMES = [...FEATURE_NAMES, ...DERIV_FEATURE_NAMES] as const;

export const POOLED_FEATURE_LABELS: Record<string, string> = {
  ...FEATURE_LABELS,
  oi_chg_1: "Изменение открытого интереса (1 свеча)",
  oi_chg_24: "Изменение открытого интереса (24 свечи)",
  oi_x_price: "Открытый интерес вместе с ценой",
  ls_global_z: "Перекос лонг/шорт по всем счетам",
  ls_global_chg_24: "Сдвиг лонг/шорт за 24 свечи",
  ls_top_z: "Перекос позиций крупных трейдеров",
  taker_z: "Перевес рыночных покупок",
  funding: "Ставка финансирования",
  funding_z: "Ставка финансирования против обычной",
};

/** Bars of history for the z-scores (a week of 1h bars). */
const Z_WINDOW = 168;
const Z_MIN = 100;
const CLIP = 6;

const clip = (v: number) => (Number.isFinite(v) ? Math.max(-CLIP, Math.min(CLIP, v)) : NaN);

/** Mean and std of the finite values in the trailing window ending at i (inclusive). */
function trailingStats(values: number[], window: number): Array<{ mean: number; sd: number } | null> {
  const out: Array<{ mean: number; sd: number } | null> = new Array(values.length).fill(null);
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) {
      sum += v;
      sumSq += v * v;
      count++;
    }
    const old = i - window >= 0 ? values[i - window] : NaN;
    if (Number.isFinite(old)) {
      sum -= old;
      sumSq -= old * old;
      count--;
    }
    if (count >= Z_MIN) {
      const mean = sum / count;
      out[i] = { mean, sd: Math.sqrt(Math.max(sumSq / count - mean * mean, 0)) };
    }
  }
  return out;
}

/** Spread this small is floating-point noise around a constant series. */
const flat = (s: { mean: number; sd: number }) => s.sd <= 1e-9 * Math.max(1, Math.abs(s.mean));
const zOf = (v: number, s: { mean: number; sd: number } | null) => (s && !flat(s) ? (v - s.mean) / s.sd : NaN);

export interface PooledFeatureContext extends FeatureContext {
  derivs: DerivData;
}

/** Candle features + positioning; a row is null wherever either part is missing. */
export function computePooledFeatureSeries(candles: Candle[], context: PooledFeatureContext): FeatureSeries {
  const base = computeFeatureSeries(candles, { btc: context.btc });
  const bars = alignDerivs(candles, context.derivs);
  const n = candles.length;
  const val = (f: (b: NonNullable<(typeof bars)[number]>) => number) => bars.map((b) => (b ? f(b) : NaN));

  const logOi = val((b) => Math.log(b.oi));
  const dOi = logOi.map((v, i) => (i > 0 ? v - logOi[i - 1] : NaN));
  const dOiStats = trailingStats(dOi, Z_WINDOW);
  const logLsG = val((b) => Math.log(b.lsGlobal));
  const lsGStats = trailingStats(logLsG, Z_WINDOW);
  const logLsT = val((b) => Math.log(b.lsTop));
  const lsTStats = trailingStats(logLsT, Z_WINDOW);
  const logTaker = val((b) => Math.log(b.taker));
  const takerStats = trailingStats(logTaker, Z_WINDOW);
  const funding = val((b) => b.funding);
  const fundingStats = trailingStats(funding, Z_WINDOW);
  const closes = candles.map((c) => c.close);

  const rows: Array<number[] | null> = new Array(n).fill(null);
  for (let i = 24; i < n; i++) {
    const x = base.rows[i];
    const s = dOiStats[i];
    if (!x || !bars[i] || !s || !(s.sd > 0) || !Number.isFinite(logOi[i - 24])) continue;
    const oi24 = (logOi[i] - logOi[i - 24]) / (s.sd * Math.sqrt(24));
    const price24 = base.vol[i] > 0 ? Math.log(closes[i] / closes[i - 24]) / (base.vol[i] * Math.sqrt(24)) : NaN;
    const lsG = lsGStats[i];
    const extra = [
      dOi[i] / s.sd,
      oi24,
      (clip(oi24) * clip(price24)) / 3,
      zOf(logLsG[i], lsG),
      lsG && lsG.sd > 0 && Number.isFinite(logLsG[i - 24]) ? (logLsG[i] - logLsG[i - 24]) / lsG.sd : NaN,
      zOf(logLsT[i], lsTStats[i]),
      zOf(logTaker[i], takerStats[i]),
      // A typical 8h rate is 0.5–3 bp; ×1e4/3 keeps it on the same scale as the other features.
      (funding[i] * 1e4) / 3,
      // Funding often sits at the 0.01% baseline for weeks: no spread means "as usual", not missing.
      fundingStats[i] && flat(fundingStats[i]!) ? 0 : zOf(funding[i], fundingStats[i]),
    ].map(clip);
    if (extra.some((v) => !Number.isFinite(v))) continue;
    rows[i] = [...x, ...extra];
  }
  return { rows, vol: base.vol };
}
