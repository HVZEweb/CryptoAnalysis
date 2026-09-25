import {
  ADX,
  ATR,
  BollingerBands,
  CCI,
  EMA,
  MACD,
  OBV,
  RSI,
  SMA,
  StochasticRSI,
} from "technicalindicators";
import type {
  Candle,
  MarketStructure,
  SupportResistance,
  TechnicalIndicators,
  TrendDirection,
  VolatilityData,
  VolumeAnalysis,
} from "@/types";

const DAY_MS = 86_400_000;

/** Typical bar length in ms, from the spacing of the last candles. */
function barMs(candles: Candle[]): number {
  const n = candles.length;
  if (n < 2) return DAY_MS;
  return Math.max(60_000, candles[n - 1].openTime - candles[n - 2].openTime);
}

/**
 * VWAP anchored to the current UTC day for intraday bars, and to the last 20 bars for daily and
 * longer bars — a VWAP accumulated over the whole fetched history says nothing about today.
 */
export function anchoredVwap(candles: Candle[]): number {
  if (!candles.length) return 0;
  const step = barMs(candles);
  const lastOpen = candles[candles.length - 1].openTime;
  const from =
    step < DAY_MS ? Math.floor(lastOpen / DAY_MS) * DAY_MS : candles[Math.max(0, candles.length - 20)].openTime;
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    if (c.openTime < from) continue;
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
  }
  return vol > 0 ? pv / vol : candles[candles.length - 1].close;
}

function last<T>(arr: T[], fallback: T): T {
  return arr.length > 0 ? arr[arr.length - 1] : fallback;
}

function ichimoku(candles: Candle[]): TechnicalIndicators["ichimoku"] {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const midpoint = (arr: number[], period: number): number => {
    const slice = arr.slice(-period);
    return (Math.max(...slice) + Math.min(...slice)) / 2;
  };
  const tenkan = midpoint(highs, 9);
  const kijun = midpoint(lows, 26);
  return {
    tenkan,
    kijun,
    senkouA: (tenkan + kijun) / 2,
    senkouB: midpoint([...highs, ...lows], 52),
    chikou: closes[closes.length - 26] ?? closes[closes.length - 1],
  };
}

function pivotPoints(candles: Candle[]): TechnicalIndicators["pivotPoints"] {
  const lastCandle = candles[candles.length - 1];
  const pivot = (lastCandle.high + lastCandle.low + lastCandle.close) / 3;
  return {
    pivot,
    r1: 2 * pivot - lastCandle.low,
    r2: pivot + (lastCandle.high - lastCandle.low),
    r3: lastCandle.high + 2 * (pivot - lastCandle.low),
    s1: 2 * pivot - lastCandle.high,
    s2: pivot - (lastCandle.high - lastCandle.low),
    s3: lastCandle.low - 2 * (lastCandle.high - pivot),
  };
}

function fibonacci(candles: Candle[]): TechnicalIndicators["fibonacci"] {
  const recent = candles.slice(-50);
  const high = Math.max(...recent.map((c) => c.high));
  const low = Math.min(...recent.map((c) => c.low));
  const diff = high - low;
  return {
    level0: high,
    level236: high - diff * 0.236,
    level382: high - diff * 0.382,
    level500: high - diff * 0.5,
    level618: high - diff * 0.618,
    level786: high - diff * 0.786,
    level100: low,
  };
}

function superTrend(candles: Candle[], period = 10, multiplier = 3): TechnicalIndicators["superTrend"] {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period });
  const atrVal = last(atrValues, 0);
  const lastCandle = candles[candles.length - 1];
  const hl2 = (lastCandle.high + lastCandle.low) / 2;
  const lowerBand = hl2 - multiplier * atrVal;
  const direction = lastCandle.close > lowerBand ? "bullish" : "bearish";
  return { value: direction === "bullish" ? lowerBand : hl2 + multiplier * atrVal, direction };
}

export function calculateIndicators(candles: Candle[]): TechnicalIndicators {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const price = closes[closes.length - 1];

  const rsiValues = RSI.calculate({ values: closes, period: 14 });
  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const ema20 = EMA.calculate({ period: 20, values: closes });
  const ema50 = EMA.calculate({ period: 50, values: closes });
  const ema100 = EMA.calculate({ period: 100, values: closes });
  const ema200 = EMA.calculate({ period: 200, values: closes });
  const smaValues = SMA.calculate({ period: 20, values: closes });
  const bbValues = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
  const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const adxValues = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const obvValues = OBV.calculate({ close: closes, volume: volumes });
  const stochRsi = StochasticRSI.calculate({
    values: closes,
    rsiPeriod: 14,
    stochasticPeriod: 14,
    kPeriod: 3,
    dPeriod: 3,
  });
  const cciValues = CCI.calculate({ high: highs, low: lows, close: closes, period: 20 });

  const lastMacd = last(macdValues, { MACD: 0, signal: 0, histogram: 0 });
  const lastBb = last(bbValues, { upper: price, middle: price, lower: price, pb: 0.5 });
  const lastStoch = last(stochRsi, { k: 50, d: 50, stochRSI: 50 });

  return {
    rsi: last(rsiValues, 50),
    macd: {
      macd: lastMacd.MACD ?? 0,
      signal: lastMacd.signal ?? 0,
      histogram: lastMacd.histogram ?? 0,
    },
    ema20: last(ema20, price),
    ema50: last(ema50, price),
    ema100: last(ema100, price),
    ema200: last(ema200, price),
    sma: last(smaValues, price),
    bollingerBands: {
      upper: lastBb.upper,
      middle: lastBb.middle,
      lower: lastBb.lower,
    },
    atr: last(atrValues, 0),
    adx: adxValues.length > 0 ? adxValues[adxValues.length - 1].adx : 25,
    vwap: anchoredVwap(candles),
    obv: last(obvValues, 0),
    stochasticRsi: { k: lastStoch.k, d: lastStoch.d },
    cci: last(cciValues, 0),
    ichimoku: ichimoku(candles),
    pivotPoints: pivotPoints(candles),
    fibonacci: fibonacci(candles),
    superTrend: superTrend(candles),
  };
}

export function analyzeMarketStructure(candles: Candle[]): MarketStructure {
  if (candles.length < 2) {
    return {
      higherHighs: false,
      higherLows: false,
      lowerHighs: false,
      lowerLows: false,
      trend: "Sideways",
    };
  }

  const recent = candles.slice(-20);
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);
  const mid = Math.floor(recent.length / 2);
  const higherHighs = Math.max(...highs.slice(mid)) > Math.max(...highs.slice(0, mid));
  const higherLows = Math.min(...lows.slice(mid)) > Math.min(...lows.slice(0, mid));
  const lowerHighs = Math.max(...highs.slice(mid)) < Math.max(...highs.slice(0, mid));
  const lowerLows = Math.min(...lows.slice(mid)) < Math.min(...lows.slice(0, mid));
  let trend: TrendDirection = "Sideways";
  if (higherHighs && higherLows) trend = "Bullish";
  else if (lowerHighs && lowerLows) trend = "Bearish";
  return { higherHighs, higherLows, lowerHighs, lowerLows, trend };
}

export function analyzeVolume(candles: Candle[]): VolumeAnalysis {
  if (candles.length === 0) {
    return {
      volumeTrend: "stable",
      averageVolume30d: 0,
      anomalousVolume: false,
      recentVolumes: [],
    };
  }

  // The newest candle is still forming, so its volume is partial — compare closed candles only.
  const closed = candles.length > 1 ? candles.slice(0, -1) : candles;
  const volumes = closed.map((c) => c.volume);
  const recent10 = volumes.slice(-10);
  const prev10 = volumes.slice(-20, -10);
  const avgRecent = recent10.reduce((a, b) => a + b, 0) / recent10.length;
  const avgPrev = prev10.length ? prev10.reduce((a, b) => a + b, 0) / prev10.length : avgRecent;
  let volumeTrend: VolumeAnalysis["volumeTrend"] = "stable";
  if (avgRecent > avgPrev * 1.1) volumeTrend = "increasing";
  else if (avgRecent < avgPrev * 0.9) volumeTrend = "decreasing";
  // Average volume per candle over the last 30 closed candles (base-asset units, same as candle volume).
  const window = volumes.slice(-31, -1);
  const averageVolume30d = window.length ? window.reduce((a, b) => a + b, 0) / window.length : volumes[volumes.length - 1];
  return {
    volumeTrend,
    averageVolume30d,
    anomalousVolume: (volumes[volumes.length - 1] ?? 0) > averageVolume30d * 2,
    recentVolumes: recent10,
  };
}

export function calculateVolatility(candles: Candle[]): VolatilityData {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const atrVal = last(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }), 0);

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (returns.length < 2) return { atr: atrVal, dailyVolatility: 0, weeklyVolatility: 0 };
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const std = Math.sqrt(returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1));
  const barsPerDay = DAY_MS / barMs(candles);
  const daily = std * Math.sqrt(barsPerDay);

  return { atr: atrVal, dailyVolatility: daily * 100, weeklyVolatility: daily * Math.sqrt(7) * 100 };
}

/** Swing lows/highs: a bar whose low/high is the extreme of the `span` bars on each side. */
function swingPoints(candles: Candle[], span = 3): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = span; i < candles.length - span; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - span; j <= i + span; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push(candles[i].high);
    if (isLow) lows.push(candles[i].low);
  }
  return { highs, lows };
}

export function calculateLevels(candles: Candle[], currentPrice: number): SupportResistance {
  const recent = candles.slice(-150);
  const atr = last(
    ATR.calculate({
      high: recent.map((c) => c.high),
      low: recent.map((c) => c.low),
      close: recent.map((c) => c.close),
      period: 14,
    }),
    currentPrice * 0.01
  );
  // A level a fraction of an ATR away is just the last candle's wick, not support.
  const minDistance = Math.max(atr * 0.5, currentPrice * 0.001);
  const swings = swingPoints(recent);
  const resistanceLevels = swings.highs.filter((h) => h - currentPrice >= minDistance).sort((a, b) => a - b);
  const supportLevels = swings.lows.filter((l) => currentPrice - l >= minDistance).sort((a, b) => b - a);

  const allLevels = [...swings.highs, ...swings.lows].sort((a, b) => a - b);
  const strongLevels = [...new Set(allLevels)].filter(
    (level) => allLevels.filter((l) => Math.abs(l - level) / level < 0.005).length >= 3
  );

  const recentLow = Math.min(...recent.map((c) => c.low));
  const recentHigh = Math.max(...recent.map((c) => c.high));
  const nearestSupport =
    supportLevels[0] ?? (currentPrice - recentLow >= minDistance ? recentLow : currentPrice - minDistance * 2);
  const nearestResistance =
    resistanceLevels[0] ?? (recentHigh - currentPrice >= minDistance ? recentHigh : currentPrice + minDistance * 2);
  return {
    nearestSupport,
    nearestResistance,
    strongLevels: strongLevels.slice(0, 5),
    liquidityZones: [nearestSupport, nearestResistance, ...strongLevels.slice(0, 4)].filter(
      (v, i, a) => a.indexOf(v) === i
    ),
  };
}
