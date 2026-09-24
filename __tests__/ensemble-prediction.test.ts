import { describe, expect, it, vi } from "vitest";
import { EnsemblePredictor, scoreToDirectionCalibrated } from "@/services/ensemble-prediction";
import { extractMlFeatures } from "@/services/ml-features";
import * as predictorModule from "@/services/predictor";
import type { PricePrediction } from "@/services/predictor";
import type { AnalysisContext, TechnicalIndicators } from "@/types";

function mockInd(): TechnicalIndicators {
  return {
    rsi: 55,
    macd: { macd: 1, signal: 0.5, histogram: 0.5 },
    ema20: 100,
    ema50: 99,
    ema100: 98,
    ema200: 95,
    sma: 100,
    bollingerBands: { upper: 105, middle: 100, lower: 95 },
    atr: 2,
    adx: 28,
    vwap: 100,
    obv: 1000,
    stochasticRsi: { k: 55, d: 50 },
    cci: 20,
    ichimoku: { tenkan: 100, kijun: 99, senkouA: 98, senkouB: 97, chikou: 100 },
    pivotPoints: { pivot: 100, r1: 101, r2: 102, r3: 103, s1: 99, s2: 98, s3: 97 },
    fibonacci: {
      level0: 90,
      level236: 92,
      level382: 94,
      level500: 95,
      level618: 96,
      level786: 97,
      level100: 100,
    },
    superTrend: { value: 99, direction: "bullish" },
  };
}

function mockContext(): AnalysisContext {
  const candles = Array.from({ length: 30 }, (_, i) => ({
    openTime: i,
    open: 100 + i * 0.1,
    high: 101 + i * 0.1,
    low: 99 + i * 0.1,
    close: 100 + i * 0.1,
    volume: 1000,
    closeTime: i + 1,
    quoteVolume: 100000,
    trades: 100,
  }));
  return {
    coin: { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
    market: "Futures",
    timeframe: "4h",
    marketData: {
      symbol: "BTC",
      price: 103,
      priceChange24h: 1,
      priceChangePercent24h: 1,
      high24h: 105,
      low24h: 100,
      volume: 1e6,
      quoteVolume: 1e8,
      trades: 1e5,
      fundingRate: 0.0001,
      openInterest: 1e9,
    },
    candles: { "1h": candles },
    indicators: { "1h": mockInd() },
    marketStructure: {
      higherHighs: true,
      higherLows: true,
      lowerHighs: false,
      lowerLows: false,
      trend: "Bullish",
    },
    volumeAnalysis: {
      volumeTrend: "stable",
      averageVolume30d: 1000,
      anomalousVolume: false,
      recentVolumes: [1000, 1100],
    },
    volatility: { atr: 2, dailyVolatility: 4, weeklyVolatility: 8 },
    levels: {
      nearestSupport: 100,
      nearestResistance: 105,
      strongLevels: [100, 105],
      liquidityZones: [101],
    },
    news: { items: [], positive: 2, negative: 1, neutral: 3, summary: "Neutral" },
    fearGreed: { value: 55, classification: "Neutral" },
    btcDominance: { dominance: 58, change24h: 0.1 },
    globalMarket: { totalMarketCap: 1e12, totalVolume: 1e11, marketCapChange24h: 0.5 },
  };
}

describe("extractMlFeatures", () => {
  it("produces ordered feature vector", () => {
    const f = extractMlFeatures(mockContext());
    expect(f.ordered.length).toBeGreaterThan(10);
    expect(f.values.rsi_norm).toBeDefined();
  });

  it("uses timeframe primary interval, not arbitrary first key", () => {
    const ctx = mockContext();
    ctx.indicators = { "1h": mockInd(), "4h": { ...mockInd(), rsi: 72 } };
    ctx.candles = { "1h": ctx.candles["1h"], "4h": ctx.candles["1h"] };
    const f = extractMlFeatures(ctx);
    expect(f.values.rsi_norm).toBeCloseTo((72 - 50) / 50, 2);
  });
});

describe("scoreToDirectionCalibrated", () => {
  it("does not inflate weak scores to 90%+", () => {
    const { direction, probability } = scoreToDirectionCalibrated(0.41, "partial");
    expect(direction).toBe("LONG");
    expect(probability).toBeLessThanOrEqual(72);
    expect(probability).toBeLessThan(75);
  });

  it("caps probability lower on divergent agreement", () => {
    const { probability } = scoreToDirectionCalibrated(0.41, "divergent");
    expect(probability).toBeLessThanOrEqual(58);
  });
});

describe("EnsemblePredictor", () => {
  it("combines LLM and ML without throwing", async () => {
    vi.spyOn(predictorModule, "runPricePredictor").mockReturnValueOnce({
      result: {
        ml: {
          direction: "LONG",
          probability: 54,
          probabilityUp: 54,
          probabilityDown: 46,
          model: "predictor_4h",
          confidence: 8,
          keyFeatures: ["RSI 14 ↑"],
          source: "predictor",
          validationAccuracy: 52.1,
        },
        priceForecast: {
          predictedPrice: 101,
          predictedHigh: 104,
          predictedLow: 97,
          confidenceBand: { low: 98, high: 103 },
          expectedMovePct: 1,
          source: "predictor",
        },
      } as PricePrediction,
    });
    const ctx = mockContext();
    const snapshot = {
      indicators: ctx.indicators,
      marketData: ctx.marketData,
      marketStructure: ctx.marketStructure,
      volumeAnalysis: ctx.volumeAnalysis,
      volatility: ctx.volatility,
      levels: ctx.levels,
      news: ctx.news,
      fearGreed: ctx.fearGreed,
      btcDominance: ctx.btcDominance,
      globalMarket: ctx.globalMarket,
      primaryTimeframe: "1h",
    };
    const predictor = new EnsemblePredictor();
    const { prediction, breakdown } = await predictor.combine(ctx, snapshot, {
      coin: "Bitcoin",
      symbol: "BTC",
      market: "Futures",
      timeframe: "4h",
      direction: "LONG",
      probability: 65,
      probabilityUp: 65,
      probabilityDown: 35,
      confidence: "Medium",
      priceRange: { low: 100, high: 108 },
      reasons: ["AI bullish"],
      risks: ["Volatility"],
      keyFactors: ["EMA stack"],
      recommendation: "Consider long",
      disclaimer: "Not financial advice",
    });
    expect(["LONG", "SHORT", "SIDEWAYS"]).toContain(prediction.direction);
    expect(breakdown.ml.model).toBeTruthy();
    expect(breakdown.effectiveWeights).toBeDefined();
    expect(breakdown.mlAvailable).toBe(true);
    expect(prediction.ensembleScore).toBeDefined();
    expect(prediction.priceForecast?.predictedPrice).toBe(101);
  });

  it("continues with LLM + rules when ML subsystem fails", async () => {
    vi.spyOn(predictorModule, "runPricePredictor").mockReturnValueOnce({
      result: null,
      error: "model_not_trained",
    });

    const ctx = mockContext();
    const snapshot = {
      indicators: ctx.indicators,
      marketData: ctx.marketData,
      marketStructure: ctx.marketStructure,
      volumeAnalysis: ctx.volumeAnalysis,
      volatility: ctx.volatility,
      levels: ctx.levels,
      news: ctx.news,
      fearGreed: ctx.fearGreed,
      btcDominance: ctx.btcDominance,
      globalMarket: ctx.globalMarket,
      primaryTimeframe: "1h",
    };
    const predictor = new EnsemblePredictor();
    const { prediction, breakdown } = await predictor.combine(ctx, snapshot, {
      coin: "Bitcoin",
      symbol: "BTC",
      market: "Futures",
      timeframe: "4h",
      direction: "LONG",
      probability: 70,
      probabilityUp: 70,
      probabilityDown: 30,
      confidence: "High",
      priceRange: { low: 100, high: 108 },
      reasons: ["AI bullish"],
      risks: [],
      keyFactors: [],
      recommendation: "Long bias",
      disclaimer: "Not financial advice",
    });

    expect(breakdown.mlAvailable).toBe(false);
    expect(breakdown.effectiveWeights.ml).toBe(0);
    expect(breakdown.effectiveWeights.llm).toBeCloseTo(0.5 / 0.65, 2);
    expect(prediction.direction).toBeDefined();
  });

  it("does not mark High confidence when LLM disagrees with final direction", async () => {
    const ctx = mockContext();
    const snapshot = {
      indicators: ctx.indicators,
      marketData: ctx.marketData,
      marketStructure: ctx.marketStructure,
      volumeAnalysis: ctx.volumeAnalysis,
      volatility: ctx.volatility,
      levels: ctx.levels,
      news: ctx.news,
      fearGreed: ctx.fearGreed,
      btcDominance: ctx.btcDominance,
      globalMarket: ctx.globalMarket,
      primaryTimeframe: "1h",
    };
    const predictor = new EnsemblePredictor();
    const { prediction } = await predictor.combine(ctx, snapshot, {
      coin: "Ethereum",
      symbol: "ETH",
      market: "Futures",
      timeframe: "4h",
      direction: "SIDEWAYS",
      probability: 52,
      probabilityUp: 52,
      probabilityDown: 48,
      confidence: "Medium",
      priceRange: { low: 100, high: 108 },
      reasons: ["Mixed signals"],
      risks: ["Low ADX"],
      keyFactors: ["Range-bound"],
      recommendation: "Wait for clearer setup",
      disclaimer: "Not financial advice",
    });

    if (prediction.direction !== "SIDEWAYS") {
      expect(prediction.confidence).not.toBe("High");
      expect(prediction.probability).toBeLessThanOrEqual(72);
      expect(prediction.recommendation).toContain("Ensemble:");
    }
  });
});
