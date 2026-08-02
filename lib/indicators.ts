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
  VWAP,
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
  const vwapValues = VWAP.calculate({ high: highs, low: lows, close: closes, volume: volumes });
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
    vwap: last(vwapValues, price),
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

  const volumes = candles.map((c) => c.volume);
  const recent10 = volumes.slice(-10);
  const prev10 = volumes.slice(-20, -10);
  const avgRecent = recent10.reduce((a, b) => a + b, 0) / recent10.length;
  const avgPrev = prev10.length ? prev10.reduce((a, b) => a + b, 0) / prev10.length : avgRecent;
  let volumeTrend: VolumeAnalysis["volumeTrend"] = "stable";
  if (avgRecent > avgPrev * 1.1) volumeTrend = "increasing";
  else if (avgRecent < avgPrev * 0.9) volumeTrend = "decreasing";
  const averageVolume30d = volumes.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, volumes.length);
  return {
    volumeTrend,
    averageVolume30d,
    anomalousVolume: (volumes[volumes.length - 1] ?? 0) > averageVolume30d * 2,
    recentVolumes: recent10,
  };
}

export function calculateVolatility(candles: Candle[], interval: string): VolatilityData {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const atrVal = last(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }), 0);

  const step = interval.includes("d") ? 1 : interval === "4h" ? 6 : interval === "1h" ? 24 : 96;
  const dailyReturns: number[] = [];
  for (let i = step; i < closes.length; i += step) {
    dailyReturns.push(Math.abs((closes[i] - closes[i - step]) / closes[i - step]));
  }
  const weeklyReturns: number[] = [];
  const weekStep = step * 7;
  for (let i = weekStep; i < closes.length; i += weekStep) {
    weeklyReturns.push(Math.abs((closes[i] - closes[i - weekStep]) / closes[i - weekStep]));
  }
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  return { atr: atrVal, dailyVolatility: avg(dailyReturns) * 100, weeklyVolatility: avg(weeklyReturns) * 100 };
}

export function calculateLevels(candles: Candle[], currentPrice: number): SupportResistance {
  const recent = candles.slice(-100);
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);
  const resistanceLevels = highs.filter((h) => h > currentPrice).sort((a, b) => a - b);
  const supportLevels = lows.filter((l) => l < currentPrice).sort((a, b) => b - a);
  const allLevels = [...new Set([...highs, ...lows])].sort((a, b) => a - b);
  const strongLevels = allLevels.filter((level, _, arr) => {
    return arr.filter((l) => Math.abs(l - level) / level < 0.005).length >= 3;
  });
  const nearestSupport = supportLevels[0] ?? currentPrice * 0.95;
  const nearestResistance = resistanceLevels[0] ?? currentPrice * 1.05;
  return {
    nearestSupport,
    nearestResistance,
    strongLevels: strongLevels.slice(0, 5),
    liquidityZones: [nearestSupport, nearestResistance, ...strongLevels.slice(0, 4)].filter(
      (v, i, a) => a.indexOf(v) === i
    ),
  };
}
