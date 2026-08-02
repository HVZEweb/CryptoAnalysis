import { describe, expect, it } from "vitest";
import { detectMarketRegime, regimeToFeature } from "@/lib/market-regime";
import type { AnalysisContext, AnalysisSnapshot } from "@/types";

function baseContext(overrides: Partial<AnalysisContext> = {}): AnalysisContext {
  return {
    coin: { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
    market: "Futures",
    timeframe: "4h",
    marketData: {
      symbol: "BTCUSDT",
      price: 100,
      priceChange24h: 1,
      priceChangePercent24h: 1,
      high24h: 105,
      low24h: 95,
      volume: 1e6,
      quoteVolume: 1e8,
      trades: 1e5,
      fundingRate: 0.0001,
    },
    candles: {},
    indicators: {
      "1h": {
        rsi: 62,
        macd: { macd: 1, signal: 0.5, histogram: 0.5 },
        ema20: 100,
        ema50: 99,
        ema100: 98,
        ema200: 95,
        sma: 100,
        bollingerBands: { upper: 105, middle: 100, lower: 95 },
        atr: 2,
        adx: 30,
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
      },
      "4h": {
        rsi: 58,
        macd: { macd: 0.5, signal: 0.3, histogram: 0.2 },
        ema20: 99,
        ema50: 98,
        ema100: 97,
        ema200: 94,
        sma: 99,
        bollingerBands: { upper: 104, middle: 99, lower: 94 },
        atr: 2.5,
        adx: 28,
        vwap: 99,
        obv: 900,
        stochasticRsi: { k: 52, d: 50 },
        cci: 15,
        ichimoku: { tenkan: 99, kijun: 98, senkouA: 97, senkouB: 96, chikou: 99 },
        pivotPoints: { pivot: 99, r1: 100, r2: 101, r3: 102, s1: 98, s2: 97, s3: 96 },
        fibonacci: {
          level0: 90,
          level236: 92,
          level382: 94,
          level500: 95,
          level618: 96,
          level786: 97,
          level100: 100,
        },
        superTrend: { value: 98, direction: "bullish" },
      },
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
      averageVolume30d: 1000,
      anomalousVolume: false,
      recentVolumes: [1000, 1100],
    },
    volatility: { atr: 2, dailyVolatility: 4, weeklyVolatility: 8 },
    levels: {
      nearestSupport: 95,
      nearestResistance: 105,
      strongLevels: [95, 105],
      liquidityZones: [100],
    },
    news: { items: [], positive: 1, negative: 0, neutral: 2, summary: "Neutral" },
    fearGreed: { value: 55, classification: "Neutral" },
    btcDominance: { dominance: 58, change24h: 0.1 },
    globalMarket: { totalMarketCap: 1e12, totalVolume: 1e11, marketCapChange24h: 0.5 },
    onChainFlow: {
      fundingOi: {
        fundingRate: 0.0001,
        fundingRateAvg8h: 0.0001,
        fundingTrend: "stable",
        openInterest: 1e9,
        openInterestChange24hPct: 3,
      },
      liquidations: { levels: [], source: "estimated" },
      orderFlow: { cvd: 0.2, cvdTrend: "rising", takerBuyRatio: 0.55, deltaImbalance: 0.1, source: "binance" },
    },
    ...overrides,
  };
}

function snapshotFrom(ctx: AnalysisContext): AnalysisSnapshot {
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
    onChainFlow: ctx.onChainFlow,
    marketRegime: ctx.marketRegime,
  };
}

describe("detectMarketRegime", () => {
  it("detects Strong Bull in bullish setup", () => {
    const ctx = baseContext();
    const regime = detectMarketRegime(ctx, snapshotFrom(ctx));
    expect(["Strong Bull", "Breakout"]).toContain(regime.regime);
    expect(regime.confidence).toBeGreaterThan(30);
    expect(regime.signals.length).toBeGreaterThan(0);
  });

  it("encodes regime to ML feature", () => {
    const f = regimeToFeature({
      regime: "Strong Bear",
      confidence: 80,
      score: -0.75,
      signals: [],
    });
    expect(f).toBeLessThan(0);
  });
});
