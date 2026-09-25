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

function rawPrediction(overrides: Partial<PredictionResult> = {}): PredictionResult {
  const entry = 64029.6;
  return {
    coin: "Bitcoin",
    symbol: "BTC",
    market: "Futures",
    timeframe: "15m",
    direction: "SHORT",
    probability: 55,
    probabilityUp: 45,
    probabilityDown: 55,
    confidence: "Low",
    priceRange: { low: 63750, high: 64150 },
    reasons: ["test"],
    risks: ["test"],
    keyFactors: ["test"],
    recommendation: "short",
    disclaimer: "disc",
    createdAt: new Date().toISOString(),
    priceAtPrediction: entry,
    coinId: "bitcoin",
    ...overrides,
  };
}

describe("refinePrediction", () => {
  it("never flips or strengthens the ensemble's call", () => {
    const refined = refinePrediction(rawPrediction(), mockBtcAnalysis(), "15m");
    expect(refined.direction).toBe("SHORT");
    expect(refined.probability).toBe(55);
    expect(refined.confidence).toBe("Low");
    expect(refined.risks.some((r) => r.includes("старших таймфреймов"))).toBe(true);
  });

  it("ignores support/resistance that sits right at the price", () => {
    const analysis = mockBtcAnalysis();
    const entry = 64029.6;
    const atr = 265.92;
    const refined = refinePrediction(rawPrediction(), analysis, "15m");
    // nearestResistance is 0.2 away from entry — the stop must come from ATR instead.
    expect(refined.tradeLevels!.sl - entry).toBeGreaterThanOrEqual(atr * 0.7);
    expect(entry - refined.tradeLevels!.tp).toBeGreaterThanOrEqual(atr * 0.9);
  });

  it("does not stretch a 15m plan to a far support/resistance (the reported ETH 15m case)", () => {
    const analysis = mockBtcAnalysis();
    const entry = 64029.6;
    const atr = 265.92;
    // Resistance 5 ATR above a SHORT: it belongs to a longer horizon, not to a 15m stop.
    analysis.levels = { ...analysis.levels, nearestResistance: entry + atr * 5, nearestSupport: entry - atr * 6 };
    const { tradeLevels } = refinePrediction(rawPrediction(), analysis, "15m");
    const slDist = tradeLevels!.sl - entry;
    const tpDist = entry - tradeLevels!.tp;
    expect(slDist).toBeLessThanOrEqual(atr * 0.75 * 1.3 + 1e-6);
    expect(tpDist).toBeLessThanOrEqual(slDist * 1.5 + 1e-6);
  });

  it("still uses a nearby level to place the stop", () => {
    const analysis = mockBtcAnalysis();
    const entry = 64029.6;
    const atr = 265.92;
    const resistance = entry + atr * 0.9;
    analysis.levels = { ...analysis.levels, nearestResistance: resistance };
    const { tradeLevels } = refinePrediction(rawPrediction(), analysis, "15m");
    expect(tradeLevels!.sl).toBeCloseTo(resistance);
  });

  it("prices in fees and advises against a trade that loses after them", () => {
    const refined = refinePrediction(rawPrediction(), mockBtcAnalysis(), "15m");
    const e = refined.tradeEconomics!;
    expect(e.market.netProfit).toBeLessThan(e.grossProfit);
    expect(e.market.netLoss).toBeGreaterThan(e.grossLoss);
    expect(e.market.breakevenWinRate).toBeGreaterThan(e.limit.breakevenWinRate);
    // 55% direction edge on a 1.5 R:R bracket ≈ 45% TP-first: below breakeven even with limit orders.
    expect(e.worthTrading).toBe(false);
    expect(refined.recommendation).toContain("Входить не стоит");
  });

  it("keeps the model's price forecast and range", () => {
    const forecast = {
      predictedPrice: 63990,
      predictedHigh: 64300,
      predictedLow: 63700,
      confidenceBand: { low: 63800, high: 64200 },
      expectedMovePct: -0.06,
      source: "predictor" as const,
    };
    const refined = refinePrediction(rawPrediction({ priceForecast: forecast }), mockBtcAnalysis(), "15m");
    expect(refined.priceForecast).toEqual(forecast);
    expect(refined.priceRange).toEqual({ low: 63700, high: 64300 });
  });

  it("has no trade economics for SIDEWAYS", () => {
    const refined = refinePrediction(
      rawPrediction({ direction: "SIDEWAYS", probability: 50, probabilityUp: 50, probabilityDown: 50 }),
      mockBtcAnalysis(),
      "15m"
    );
    expect(refined.tradeEconomics).toBeUndefined();
    expect(refined.direction).toBe("SIDEWAYS");
  });
});

describe("refinePrediction with the strategy lab", () => {
  it("offers no trade when the lab found no setup that pays after fees", () => {
    const refined = refinePrediction(
      rawPrediction({ strategy: { status: "no_setup", reason: "прибыль не подтвердилась на новых данных" } }),
      mockBtcAnalysis(),
      "15m"
    );
    expect(refined.recommendation).toMatch(/^Выгодной сделки сейчас нет: прибыль не подтвердилась/);
  });

  it("uses the validated setup's levels and holding time for a trade", () => {
    const refined = refinePrediction(
      rawPrediction({
        strategy: {
          status: "trade",
          side: "SHORT",
          reason: "ok",
          setup: { slAtr: 1, rr: 2, horizonBars: 4, interval: "15m", minEdge: 0.04 },
          holdout: { trades: 80, winRate: 0.4, avgNetBp: 6.2, avgNetBpTaker: 0.2, tStat: 2.1, tradesPerWeek: 3 },
          levels: { sl: 64229.6, tp: 63629.6 },
        },
      }),
      mockBtcAnalysis(),
      "15m"
    );
    expect(refined.tradeLevels).toMatchObject({ sl: 64229.6, tp: 63629.6 });
    expect(refined.recommendation).toContain("проверенная стратегия");
    expect(refined.recommendation).toContain("4 × 15m");
    expect(refined.recommendation).toContain("вход рыночным ордером");
    expect(refined.recommendation).toContain("TP выставить лимитным");
  });
});

