import { describe, expect, it } from "vitest";
import { refinePrediction, getHigherTimeframeBias } from "@/lib/prediction-refinement";
import type { AnalysisSnapshot, PredictionResult } from "@/types";

function mockBtcAnalysis(): AnalysisSnapshot {
  const st = (dir: "bullish" | "bearish") => ({ value: 63000, direction: dir });
  return {
    indicators: {
      "15m": {
        rsi: 64.65,
        macd: { macd: 194, signal: 125, histogram: 69 },
        ema20: 63631,
        ema50: 63469,
        ema100: 63408,
        ema200: 63229,
        sma: 63530,
        bollingerBands: { upper: 64275, middle: 63530, lower: 62785 },
        atr: 265.92,
        adx: 19,
        vwap: 63116,
        obv: 18916,
        stochasticRsi: { k: 95.76, d: 96.73 },
        cci: 101.86,
        ichimoku: { tenkan: 63921, kijun: 63295, senkouA: 63608, senkouB: 63295, chikou: 63258 },
        pivotPoints: { pivot: 64027, r1: 64116, r2: 64204, r3: 64293, s1: 63940, s2: 63851, s3: 63764 },
        fibonacci: { level0: 64234, level236: 63857, level382: 63624, level500: 63436, level618: 63247, level786: 62979, level100: 62638 },
        superTrend: st("bullish"),
      },
      "1h": {
        rsi: 60,
        macd: { macd: 136, signal: 72, histogram: 64 },
        ema20: 63493,
        ema50: 63262,
        ema100: 62752,
        ema200: 61553,
        sma: 63504,
        bollingerBands: { upper: 64317, middle: 63504, lower: 62692 },
        atr: 448,
        adx: 11,
        vwap: 61221,
        obv: 155879,
        stochasticRsi: { k: 100, d: 84 },
        cci: 92,
        ichimoku: { tenkan: 63775, kijun: 63383, senkouA: 63579, senkouB: 62713, chikou: 63710 },
        pivotPoints: { pivot: 64027, r1: 64116, r2: 64204, r3: 64293, s1: 63940, s2: 63851, s3: 63764 },
        fibonacci: { level0: 64691, level236: 63890, level382: 63395, level500: 62994, level618: 62593, level786: 62023, level100: 61297 },
        superTrend: st("bullish"),
      },
      "4h": {
        rsi: 62,
        macd: { macd: 528, signal: 544, histogram: -15 },
        ema20: 63119,
        ema50: 62276,
        ema100: 62028,
        ema200: 62506,
        sma: 63216,
        bollingerBands: { upper: 64127, middle: 63216, lower: 62305 },
        atr: 822,
        adx: 23,
        vwap: 62134,
        obv: -279639,
        stochasticRsi: { k: 48, d: 33 },
        cci: 158,
        ichimoku: { tenkan: 63959, kijun: 62538, senkouA: 63248, senkouB: 60769, chikou: 61895 },
        pivotPoints: { pivot: 64014, r1: 64249, r2: 64468, r3: 64702, s1: 63795, s2: 63560, s3: 63341 },
        fibonacci: { level0: 64691, level236: 63055, level382: 62043, level500: 61225, level618: 60407, level786: 59242, level100: 57758 },
        superTrend: st("bullish"),
      },
    },
    marketData: {
      symbol: "BTCUSDT",
      price: 64029.6,
      priceChange24h: 305,
      priceChangePercent24h: 0.479,
      high24h: 64691,
      low24h: 62638,
      volume: 187515,
      quoteVolume: 11918018681,
      trades: 4306830,
    },
    marketStructure: {
      higherHighs: true,
      higherLows: true,
      lowerHighs: false,
      lowerLows: false,
      trend: "Bullish",
    },
    volumeAnalysis: {
      volumeTrend: "stable",
      averageVolume30d: 2663,
      anomalousVolume: false,
      recentVolumes: [974],
    },
    volatility: { atr: 265.92, dailyVolatility: 1.28, weeklyVolatility: 0 },
    levels: {
      nearestSupport: 64002,
      nearestResistance: 64029.8,
      strongLevels: [62638],
      liquidityZones: [64002],
    },
    news: { items: [], positive: 0, negative: 0, neutral: 1, summary: "Нейтрально" },
    fearGreed: { value: 27, classification: "Fear" },
    btcDominance: { dominance: 56, change24h: 0 },
    globalMarket: { totalMarketCap: 2.29e12, totalVolume: 76e9, marketCapChange24h: 0.37 },
    primaryTimeframe: "15m",
  };
}

describe("getHigherTimeframeBias", () => {
  it("detects bullish higher TF", () => {
    expect(getHigherTimeframeBias(mockBtcAnalysis())).toBe("bullish");
  });
});

describe("refinePrediction", () => {
  it("fixes counter-trend SHORT with overbought: wider SL, capped prob, non-zero move", () => {
    const analysis = mockBtcAnalysis();
    const entry = 64029.6;
    const atr = 265.92;

    const raw: PredictionResult = {
      coin: "Bitcoin",
      symbol: "BTC",
      market: "Futures",
      timeframe: "15m",
      direction: "SHORT",
      probability: 65,
      probabilityUp: 35,
      probabilityDown: 65,
      confidence: "Medium",
      priceRange: { low: 63750, high: 64150 },
      priceForecast: {
        predictedPrice: 63885,
        predictedHigh: 64050,
        predictedLow: 63800,
        confidenceBand: { low: 63850, high: 63920 },
        expectedMovePct: 0,
      },
      reasons: ["test"],
      risks: ["test"],
      keyFactors: ["test"],
      recommendation: "short",
      disclaimer: "disc",
      createdAt: new Date().toISOString(),
      priceAtPrediction: entry,
      coinId: "bitcoin",
      tradeLevels: { entry, tp: 63800, sl: 64150, exit: 63885 },
    };

    const refined = refinePrediction(raw, analysis, "15m");

    expect(refined.direction).toBe("SHORT");
    expect(refined.probability).toBeLessThanOrEqual(58);
    expect(refined.confidence).toBe("Low");
    expect(refined.priceForecast!.expectedMovePct).not.toBe(0);
    expect(Math.abs(refined.priceForecast!.expectedMovePct)).toBeGreaterThan(0.08);

    const slDist = refined.tradeLevels!.sl - entry;
    expect(slDist).toBeGreaterThanOrEqual(atr * 0.7);

    const tpDist = entry - refined.tradeLevels!.tp;
    expect(tpDist).toBeGreaterThanOrEqual(atr * 0.9);

    expect(refined.refinementNotes!.length).toBeGreaterThan(0);
    expect(refined.risks.some((r) => r.includes("Контртренд"))).toBe(true);
  });

  it("converts counter-trend SHORT without overbought to SIDEWAYS", () => {
    const analysis = mockBtcAnalysis();
    analysis.indicators["15m"]!.stochasticRsi.k = 55;
    analysis.indicators["15m"]!.rsi = 52;

    const raw: PredictionResult = {
      coin: "Bitcoin",
      symbol: "BTC",
      market: "Futures",
      timeframe: "15m",
      direction: "SHORT",
      probability: 65,
      probabilityUp: 35,
      probabilityDown: 65,
      confidence: "Medium",
      priceRange: { low: 63750, high: 64150 },
      priceForecast: {
        predictedPrice: 63885,
        predictedHigh: 64050,
        predictedLow: 63800,
        confidenceBand: { low: 63850, high: 63920 },
        expectedMovePct: -0.23,
      },
      reasons: ["test"],
      risks: ["test"],
      keyFactors: ["test"],
      recommendation: "short",
      disclaimer: "disc",
      createdAt: new Date().toISOString(),
      priceAtPrediction: 64029.6,
      coinId: "bitcoin",
    };

    const refined = refinePrediction(raw, analysis, "15m");
    expect(refined.direction).toBe("SIDEWAYS");
    expect(refined.probability).toBe(50);
  });
});
