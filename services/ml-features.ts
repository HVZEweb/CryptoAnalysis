/**
 * ML feature vector from technical indicators, market structure, and macro context.
 * All values are normalized to roughly [-1, 1] or [0, 1] for model input.
 */

import { TIMEFRAME_CANDLE_CONFIG } from "@/lib/timeframe";
import type { AnalysisContext, Candle, TechnicalIndicators } from "@/types";
import { regimeToFeature } from "@/lib/market-regime";

export interface MlFeatureVector {
  /** Flat feature map for Python / ONNX backends */
  values: Record<string, number>;
  /** Ordered list for consistent model input */
  ordered: number[];
  /** Human-readable top contributors */
  labels: string[];
}

const FEATURE_ORDER = [
  "rsi_norm",
  "macd_hist_norm",
  "ema_trend",
  "bb_position",
  "adx_norm",
  "stoch_rsi_norm",
  "cci_norm",
  "vwap_dev",
  "obv_trend",
  "structure_trend",
  "volume_anomaly",
  "volatility_norm",
  "fear_greed_norm",
  "btc_dom_change",
  "market_cap_chg",
  "news_sentiment",
  "funding_norm",
  "oi_change_proxy",
  "long_short_bias",
  "momentum_5",
  "momentum_20",
  "higher_tf_rsi",
  "ichimoku_cloud",
  "regime_score",
  "oi_change_norm",
  "funding_trend_norm",
  "cvd_norm",
  "delta_imbalance",
  "liq_proximity",
] as const;

function clamp(n: number, lo = -1, hi = 1): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeRsi(rsi: number): number {
  return clamp((rsi - 50) / 50);
}

function emaTrend(ind: TechnicalIndicators, price: number): number {
  if (!price) return 0;
  const stack =
    (ind.ema20 > ind.ema50 ? 0.25 : -0.25) +
    (ind.ema50 > ind.ema100 ? 0.25 : -0.25) +
    (price > ind.ema20 ? 0.25 : -0.25) +
    (ind.superTrend.direction === "bullish" ? 0.25 : -0.25);
  return clamp(stack);
}

function bbPosition(ind: TechnicalIndicators, price: number): number {
  const { upper, lower, middle } = ind.bollingerBands;
  const range = upper - lower;
  if (range <= 0) return 0;
  return clamp(((price - middle) / (range / 2)) * 0.8);
}

function momentum(candles: Candle[], lookback: number): number {
  if (candles.length < lookback + 1) return 0;
  const last = candles[candles.length - 1].close;
  const prev = candles[candles.length - 1 - lookback].close;
  if (!prev) return 0;
  return clamp(((last - prev) / prev) * 20);
}

function obvTrend(candles: Candle[]): number {
  if (candles.length < 10) return 0;
  let obv = 0;
  const series: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1].close;
    if (c.close > p) obv += c.volume;
    else if (c.close < p) obv -= c.volume;
    series.push(obv);
  }
  const recent = series.slice(-5);
  const older = series.slice(-15, -5);
  if (!recent.length || !older.length) return 0;
  const r = recent.reduce((a, b) => a + b, 0) / recent.length;
  const o = older.reduce((a, b) => a + b, 0) / older.length;
  const denom = Math.abs(o) || 1;
  return clamp((r - o) / denom);
}

function ichimokuBias(ind: TechnicalIndicators, price: number): number {
  const cloudTop = Math.max(ind.ichimoku.senkouA, ind.ichimoku.senkouB);
  const cloudBot = Math.min(ind.ichimoku.senkouA, ind.ichimoku.senkouB);
  if (price > cloudTop) return 0.6;
  if (price < cloudBot) return -0.6;
  return 0;
}

/**
 * Build ML feature vector from full analysis context.
 */
export function extractMlFeatures(ctx: AnalysisContext): MlFeatureVector {
  const primaryTf =
    TIMEFRAME_CANDLE_CONFIG[ctx.timeframe]?.primaryInterval ??
    Object.keys(ctx.indicators)[0] ??
    "1h";
  const fallbackTf = Object.keys(ctx.indicators)[0] ?? "1h";
  const ind = ctx.indicators[primaryTf] ?? ctx.indicators[fallbackTf];
  const candles =
    ctx.candles[primaryTf] ?? ctx.candles[fallbackTf] ?? Object.values(ctx.candles)[0] ?? [];
  const price = ctx.marketData.price;

  const htfInd = ctx.indicators["4h"] ?? ctx.indicators["1h"] ?? ind;

  const values: Record<string, number> = {};

  if (ind) {
    values.rsi_norm = normalizeRsi(ind.rsi);
    values.macd_hist_norm = clamp(ind.macd.histogram / (price * 0.001 || 1));
    values.ema_trend = emaTrend(ind, price);
    values.bb_position = bbPosition(ind, price);
    values.adx_norm = clamp((ind.adx - 25) / 25);
    values.stoch_rsi_norm = clamp((ind.stochasticRsi.k - 50) / 50);
    values.cci_norm = clamp(ind.cci / 200);
    values.vwap_dev = clamp(((price - ind.vwap) / (ind.vwap || price)) * 50);
    values.ichimoku_cloud = ichimokuBias(ind, price);
  }

  values.obv_trend = obvTrend(candles);
  values.momentum_5 = momentum(candles, 5);
  values.momentum_20 = momentum(candles, 20);

  if (htfInd) {
    values.higher_tf_rsi = normalizeRsi(htfInd.rsi);
  }

  const ms = ctx.marketStructure;
  values.structure_trend =
    ms.trend === "Bullish" ? 0.7 : ms.trend === "Bearish" ? -0.7 : 0;

  values.volume_anomaly = ctx.volumeAnalysis.anomalousVolume
    ? ctx.volumeAnalysis.volumeTrend === "increasing"
      ? 0.5
      : -0.3
    : 0;

  values.volatility_norm = clamp(ctx.volatility.dailyVolatility / 15);

  values.fear_greed_norm = clamp((ctx.fearGreed.value - 50) / 50);
  values.btc_dom_change = clamp(ctx.btcDominance.change24h / 2);
  values.market_cap_chg = clamp(ctx.globalMarket.marketCapChange24h / 5);

  const newsTotal = ctx.news.positive + ctx.news.negative + ctx.news.neutral || 1;
  values.news_sentiment = clamp(
    ctx.news.aggregateScore ?? (ctx.news.positive - ctx.news.negative) / newsTotal
  );

  if (ctx.marketData.fundingRate !== undefined) {
    values.funding_norm = clamp(ctx.marketData.fundingRate * 5000);
  }
  if (ctx.marketData.openInterest !== undefined && ctx.marketData.quoteVolume) {
    values.oi_change_proxy = clamp(
      (ctx.marketData.openInterest / (ctx.marketData.quoteVolume || 1)) * 0.1
    );
  }
  if (ctx.marketData.longShortRatio !== undefined) {
    values.long_short_bias = clamp((ctx.marketData.longShortRatio - 1) * 2);
  }

  const flow = ctx.onChainFlow;
  if (flow) {
    values.oi_change_norm = clamp(flow.fundingOi.openInterestChange24hPct / 15);
    values.funding_trend_norm =
      flow.fundingOi.fundingTrend === "rising"
        ? 0.5
        : flow.fundingOi.fundingTrend === "falling"
          ? -0.5
          : 0;
    values.cvd_norm = clamp(flow.orderFlow.cvd);
    values.delta_imbalance = clamp(flow.orderFlow.deltaImbalance);

    const price = ctx.marketData.price;
    const longLiq = flow.liquidations.nearestLongLiq;
    const shortLiq = flow.liquidations.nearestShortLiq;
    if (price > 0 && longLiq && shortLiq) {
      const distLong = Math.abs((price - longLiq) / price);
      const distShort = Math.abs((shortLiq - price) / price);
      const nearer = distLong < distShort ? -0.5 : 0.5;
      values.liq_proximity = clamp(nearer * (1 - Math.min(distLong, distShort) * 10));
    }
  }

  if (ctx.marketRegime) {
    values.regime_score = regimeToFeature(ctx.marketRegime);
  }

  const ordered = FEATURE_ORDER.map((k) => values[k] ?? 0);
  const labels = FEATURE_ORDER.filter((k) => Math.abs(values[k] ?? 0) > 0.35).map(
    (k) => k
  );

  return { values, ordered, labels };
}

export { FEATURE_ORDER };
