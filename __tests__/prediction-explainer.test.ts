import { describe, expect, it } from "vitest";
import { buildPredictionExplanation } from "@/lib/explainability/prediction-explainer";
import type { PredictionResult } from "@/types";

function mockPrediction(): PredictionResult {
  return {
    coin: "Bitcoin",
    symbol: "BTC",
    market: "Futures",
    timeframe: "4h",
    direction: "LONG",
    probability: 68,
    probabilityUp: 68,
    probabilityDown: 32,
    confidence: "Medium",
    priceRange: { low: 95000, high: 99000 },
    reasons: ["EMA20 выше EMA50 — бычий стек", "Объём растёт на откатах"],
    risks: ["Перегрев RSI на 4h", "Отрицательный funding"],
    keyFactors: ["RSI 62", "Strong Bull regime"],
    recommendation: "Рассмотреть лонг к TP с жёстким SL",
    disclaimer: "Не финсовет",
    createdAt: new Date().toISOString(),
    priceAtPrediction: 97000,
    coinId: "bitcoin",
    ensembleScore: 0.25,
    mlFeatures: {
      ema_trend: 0.6,
      rsi_norm: 0.2,
      macd_hist_norm: 0.35,
      cvd_norm: 0.4,
      regime_score: 0.5,
      funding_norm: -0.15,
    },
    analysis: {
      primaryTimeframe: "4h",
      indicators: {
        "4h": {
          rsi: 62,
          macd: { macd: 100, signal: 80, histogram: 20 },
          ema20: 96500,
          ema50: 95000,
          ema100: 93000,
          ema200: 90000,
          adx: 28,
          atr: 500,
          stochasticRsi: { k: 55, d: 50 },
          cci: 80,
          vwap: 96800,
          bollingerBands: { upper: 98000, middle: 97000, lower: 96000 },
          ichimoku: { tenkan: 97000, kijun: 96500, senkouA: 96000, senkouB: 95500 },
          superTrend: { direction: "bullish", value: 96000 },
          fibonacci: { level236: 0, level382: 0, level500: 0, level618: 0, level786: 0 },
          pivotPoints: { pivot: 0, r1: 0, r2: 0, r3: 0, s1: 0, s2: 0, s3: 0 },
        },
      },
      marketData: {
        price: 97000,
        priceChangePercent24h: 2,
        quoteVolume: 1e9,
        fundingRate: -0.0001,
      },
      marketStructure: { trend: "Bullish", higherHighs: true, lowerLows: false },
      volumeAnalysis: { volumeTrend: "increasing", anomalousVolume: false },
      volatility: { dailyVolatility: 3, atr: 500 },
      levels: { nearestSupport: 95500, nearestResistance: 98500 },
      news: { positive: 2, negative: 1, neutral: 3, summary: "Нейтрально", items: [], aggregateScore: 0.1 },
      fearGreed: { value: 55, classification: "Neutral" },
      btcDominance: { dominance: 58, change24h: 0.1 },
      globalMarket: { marketCapChange24h: 1.5 },
      marketRegime: {
        regime: "Strong Bull",
        confidence: 78,
        score: 0.55,
        signals: ["HTF бычий тренд", "ADX > 25"],
      },
      onChainFlow: {
        fundingOi: {
          fundingRate: -0.0001,
          fundingRateAvg8h: -0.00008,
          fundingTrend: "falling",
          openInterest: 1e8,
          openInterestChange24hPct: 3.2,
          longShortRatio: 1.05,
        },
        orderFlow: {
          cvd: 0.35,
          cvdTrend: "rising",
          takerBuyRatio: 0.52,
          deltaImbalance: 0.15,
        },
        liquidations: {
          nearestLongLiq: 95000,
          nearestShortLiq: 99000,
          source: "proxy",
        },
      },
    },
    ensembleBreakdown: {
      weights: { llm: 0.5, ml: 0.35, rules: 0.15 },
      effectiveWeights: { llm: 0.5, ml: 0.35, rules: 0.15 },
      mlAvailable: true,
      llm: { direction: "LONG", probability: 70, score: 0.65 },
      ml: {
        direction: "LONG",
        probability: 62,
        probabilityUp: 62,
        probabilityDown: 38,
        model: "logistic",
        confidence: 58,
        keyFeatures: ["ema_trend", "macd_hist_norm"],
      },
      rules: [{ direction: "LONG", probability: 60, reason: "HTF bias up" }],
      rulesAggregateScore: 0.2,
      ensembleScore: 0.25,
      agreement: "full",
      finalDirection: "LONG",
      finalProbability: 68,
      metaTrustScore: 72,
      lowConfidence: false,
    },
  };
}

describe("buildPredictionExplanation", () => {
  it("builds Russian explanation with drivers and ensemble", () => {
    const exp = buildPredictionExplanation(mockPrediction());
    expect(exp.summary).toMatch(/лонг/i);
    expect(exp.topDrivers.length).toBeGreaterThan(0);
    expect(exp.ensembleRationale).toMatch(/Ensemble/i);
    expect(exp.ensembleVotes.length).toBe(3);
    expect(exp.strengths.length).toBeGreaterThan(0);
    expect(exp.technicalDepth).toMatch(/RSI/i);
  });

  it("flags weaknesses on divergent ensemble", () => {
    const p = mockPrediction();
    p.ensembleBreakdown = {
      ...p.ensembleBreakdown!,
      agreement: "divergent",
      ensembleScore: 0.05,
      lowConfidence: true,
    };
    const exp = buildPredictionExplanation(p);
    expect(exp.weaknesses.some((w) => w.includes("расходятся") || w.includes("слабый"))).toBe(true);
  });
});
