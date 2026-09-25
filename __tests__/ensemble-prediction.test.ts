import { describe, expect, it, vi } from "vitest";
import { EnsemblePredictor, directionEdge, probabilityToCall } from "@/services/ensemble-prediction";
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

function snapshotOf(ctx: AnalysisContext) {
  return {
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
}

function llm(direction: "LONG" | "SHORT" | "SIDEWAYS", probability: number) {
  return {
    coin: "Bitcoin",
    symbol: "BTC",
    market: "Futures" as const,
    timeframe: "15m" as const,
    direction,
    probability,
    probabilityUp: direction === "SHORT" ? 100 - probability : probability,
    probabilityDown: direction === "SHORT" ? probability : 100 - probability,
    confidence: "Medium" as const,
    priceRange: { low: 100, high: 108 },
    reasons: ["AI"],
    risks: [],
    keyFactors: [],
    recommendation: "LLM says so",
    disclaimer: "Not financial advice",
  };
}

function modelResult(probabilityUp: number, hasEdge: boolean, confidentAccuracy = 0.555): PricePrediction {
  return {
    ml: null,
    probabilityUp,
    topFeatures: [{ feature: "rsi_14", label: "RSI 14", contribution: 0.1 }],
    priceForecast: {
      predictedPrice: 101,
      predictedHigh: 104,
      predictedLow: 97,
      confidenceBand: { low: 98, high: 103 },
      expectedMovePct: 1,
      source: "predictor",
    },
    model: {
      timeframe: "15m",
      validation: { hasEdge, accuracy: 0.525, confident: { share: 0.2, accuracy: confidentAccuracy } },
    },
  } as unknown as PricePrediction;
}

describe("directionEdge / probabilityToCall", () => {
  it("scores a vote by its distance from a coin flip", () => {
    expect(directionEdge("LONG", 58)).toBeCloseTo(0.16);
    expect(directionEdge("SHORT", 58)).toBeCloseTo(-0.16);
    expect(directionEdge("SIDEWAYS", 70)).toBe(0);
  });

  it("caps the probability at the validated accuracy", () => {
    expect(probabilityToCall(0.7, 0.055)).toEqual({ direction: "LONG", probability: 55.5, probabilityUp: 55.5 });
    expect(probabilityToCall(0.3, 0.055).direction).toBe("SHORT");
  });

  it("gives no direction without a validated edge", () => {
    expect(probabilityToCall(0.9, 0)).toEqual({ direction: "SIDEWAYS", probability: 50, probabilityUp: 50 });
  });
});

describe("EnsemblePredictor", () => {
  it("does not turn weak 58%/56% votes into 64% (the reported BTC 15m case)", async () => {
    vi.spyOn(predictorModule, "runPricePredictor").mockResolvedValueOnce({ result: modelResult(0.48, true) });
    const ctx = mockContext();
    const { prediction, breakdown } = await new EnsemblePredictor().combine(ctx, snapshotOf(ctx), llm("LONG", 58));

    expect(prediction.probability).toBeLessThanOrEqual(55.5);
    expect(breakdown.ml.probabilityUp).toBe(48);
    expect(breakdown.ml.direction).toBe("SIDEWAYS");
    // The model's 48% still counts as a (small) vote for down.
    expect(breakdown.ensembleScore).toBeLessThan(0.1);
    expect(prediction.confidence).not.toBe("High");
    expect(breakdown.metaTrustScore).toBe(56);
    expect(prediction.priceForecast?.predictedPrice).toBe(101);
  });

  it("follows the validated model when it has an edge", async () => {
    vi.spyOn(predictorModule, "runPricePredictor").mockResolvedValueOnce({ result: modelResult(0.56, true) });
    const ctx = mockContext();
    const { prediction, breakdown } = await new EnsemblePredictor().combine(ctx, snapshotOf(ctx), llm("SHORT", 60));

    expect(breakdown.mlAvailable).toBe(true);
    expect(breakdown.effectiveWeights.ml).toBeCloseTo(0.85);
    expect(breakdown.effectiveWeights.llm).toBe(0);
    expect(prediction.direction).toBe("LONG");
    expect(prediction.probability).toBeLessThanOrEqual(55.5);
  });

  it("gives no direction when the model leans nowhere, however sure the LLM is (the reported ETH 15m case)", async () => {
    vi.spyOn(predictorModule, "runPricePredictor").mockResolvedValueOnce({ result: modelResult(0.497, true) });
    const ctx = mockContext();
    const { prediction } = await new EnsemblePredictor().combine(ctx, snapshotOf(ctx), llm("LONG", 90));

    expect(prediction.direction).toBe("SIDEWAYS");
    expect(prediction.probability).toBe(50);
    expect(prediction.recommendation).toMatch(/Сигнала нет/);
  });

  it("hides the direction when the model has no validated edge", async () => {
    vi.spyOn(predictorModule, "runPricePredictor").mockResolvedValueOnce({
      result: modelResult(0.6, false),
      error: "model_has_no_edge",
    });
    const ctx = mockContext();
    const { prediction, breakdown } = await new EnsemblePredictor().combine(ctx, snapshotOf(ctx), llm("LONG", 80));

    expect(prediction.direction).toBe("SIDEWAYS");
    expect(prediction.probability).toBe(50);
    expect(breakdown.mlAvailable).toBe(false);
    expect(prediction.recommendation).toContain("не прогнозируется");
    expect(prediction.priceForecast).toBeDefined();
  });

  it("gives no direction when the model is not trained", async () => {
    vi.spyOn(predictorModule, "runPricePredictor").mockResolvedValueOnce({ result: null, error: "model_not_trained" });
    const ctx = mockContext();
    const { prediction, breakdown } = await new EnsemblePredictor().combine(ctx, snapshotOf(ctx), llm("LONG", 70));

    expect(breakdown.effectiveWeights.ml).toBe(0);
    expect(prediction.direction).toBe("SIDEWAYS");
  });
});
