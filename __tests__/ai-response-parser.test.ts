import { describe, expect, it } from "vitest";
import { parseAndValidateAiResponse } from "@/lib/ai-response-parser";
import type { AnalysisContext, Coin, Timeframe } from "@/types";

const mockCoin: Coin = { id: "bitcoin", symbol: "BTC", name: "Bitcoin" };

const mockContext: AnalysisContext = {
  coin: mockCoin,
  market: "Futures",
  timeframe: "24h" as Timeframe,
  marketData: {
    symbol: "BTCUSDT",
    price: 95000,
    priceChange24h: 1000,
    priceChangePercent24h: 1.05,
    high24h: 96000,
    low24h: 94000,
    volume: 10000,
    quoteVolume: 950000000,
    trades: 500000,
  },
  candles: {},
  indicators: {},
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
    recentVolumes: [100, 110],
  },
  volatility: { atr: 500, dailyVolatility: 2, weeklyVolatility: 5 },
  levels: {
    nearestSupport: 94000,
    nearestResistance: 96000,
    strongLevels: [94500],
    liquidityZones: [94000, 96000],
  },
  news: { items: [], positive: 0, negative: 0, neutral: 1, summary: "Нейтрально" },
  fearGreed: { value: 50, classification: "Neutral" },
  btcDominance: { dominance: 58, change24h: 0.1 },
  globalMarket: { totalMarketCap: 3e12, totalVolume: 1e11, marketCapChange24h: 1 },
};

describe("parseAndValidateAiResponse", () => {
  it("parses valid JSON", () => {
    const raw = JSON.stringify({
      coin: "Bitcoin",
      symbol: "BTC",
      market: "Futures",
      timeframe: "24h",
      direction: "LONG",
      probability: 72,
      probabilityUp: 72,
      probabilityDown: 28,
      confidence: "High",
      priceRange: { low: 94000, high: 97000 },
      priceForecast: {
        predictedPrice: 96500,
        predictedHigh: 97000,
        predictedLow: 94500,
        confidenceBand: { low: 95800, high: 97200 },
        expectedMovePct: 1.58,
      },
      reasons: ["Сильный тренд"],
      risks: ["Волатильность"],
      keyFactors: ["Объём"],
      recommendation: "Ждать пробой",
      disclaimer: "Не фин. совет",
    });

    const result = parseAndValidateAiResponse(raw, mockContext);
    expect(result?.direction).toBe("LONG");
    expect(result?.probability).toBe(72);
    expect(result?.priceForecast.predictedPrice).toBe(96500);
  });

  it("normalizes markdown wrapped JSON", () => {
    const raw = '```json\n{"direction":"SHORT","probability":65,"probabilityUp":35,"probabilityDown":65,"confidence":"Medium","priceRange":{"low":93000,"high":95000},"reasons":["Медвежий тренд"],"risks":["Риск"],"keyFactors":["RSI"],"recommendation":"Осторожно","disclaimer":"Дисклеймер","coin":"BTC","symbol":"BTC","market":"Futures","timeframe":"24h"}\n```';
    const result = parseAndValidateAiResponse(raw, mockContext);
    expect(result?.direction).toBe("SHORT");
  });

  it("returns null for invalid content", () => {
    expect(parseAndValidateAiResponse("not json at all", mockContext)).toBeNull();
  });
});
