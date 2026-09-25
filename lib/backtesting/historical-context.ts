/**
 * Causal historical context builder — only data available at decision time T.
 */

import {
  analyzeMarketStructure,
  analyzeVolume,
  calculateIndicators,
  calculateLevels,
  calculateVolatility,
} from "@/lib/indicators";
import { detectMarketRegimeWithGuards } from "@/lib/market-regime";
import { TIMEFRAME_CANDLE_CONFIG, aggregateCandles } from "@/lib/timeframe";
import type {
  AnalysisContext,
  AnalysisSnapshot,
  Candle,
  Coin,
  MarketType,
  Timeframe,
} from "@/types";

const NEUTRAL_NEWS = {
  items: [],
  positive: 0,
  negative: 0,
  neutral: 1,
  summary: "Backtest — news unavailable historically",
  aggregateScore: 0,
  sentimentSource: "lexicon" as const,
};

const NEUTRAL_MACRO = {
  fearGreed: { value: 50, classification: "Neutral" },
  btcDominance: { dominance: 55, change24h: 0 },
  globalMarket: { totalMarketCap: 0, totalVolume: 0, marketCapChange24h: 0 },
};

export function sliceCandlesCausal(candles: Candle[], asOf: number): Candle[] {
  return candles.filter((c) => c.closeTime <= asOf);
}

export function buildCandleMapAtTime(
  allCandles: Record<string, Candle[]>,
  timeframe: Timeframe,
  asOf: number
): Record<string, Candle[]> {
  const config = TIMEFRAME_CANDLE_CONFIG[timeframe];
  const map: Record<string, Candle[]> = {};

  for (const interval of config.contextIntervals) {
    const raw = allCandles[interval] ?? [];
    map[interval] = sliceCandlesCausal(raw, asOf);
  }

  if (config.aggregateFrom && config.aggregateCount) {
    const source = map[config.aggregateFrom] ?? [];
    if (source.length >= config.aggregateCount) {
      map[config.primaryInterval] = aggregateCandles(source, config.aggregateCount);
    }
  }

  return map;
}

function buildMarketDataFromCandles(symbol: string, candles: Candle[], market: MarketType) {
  const last = candles[candles.length - 1];
  const lookback = candles.slice(-24);
  const high24 = Math.max(...lookback.map((c) => c.high));
  const low24 = Math.min(...lookback.map((c) => c.low));
  const first = lookback[0] ?? last;
  const change = last.close - first.open;
  const changePct = first.open > 0 ? (change / first.open) * 100 : 0;

  return {
    symbol,
    price: last.close,
    priceChange24h: change,
    priceChangePercent24h: changePct,
    high24h: high24,
    low24h: low24,
    volume: lookback.reduce((s, c) => s + c.volume, 0),
    quoteVolume: lookback.reduce((s, c) => s + c.quoteVolume, 0),
    trades: lookback.reduce((s, c) => s + c.trades, 0),
    ...(market === "Futures"
      ? { fundingRate: 0.0001, openInterest: 0, longShortRatio: 1 }
      : {}),
  };
}

function proxyOrderFlow(candles: Candle[]) {
  if (candles.length < 10) {
    return {
      fundingOi: {
        fundingRate: 0,
        fundingRateAvg8h: 0,
        fundingTrend: "stable" as const,
        openInterest: 0,
        openInterestChange24hPct: 0,
      },
      liquidations: { levels: [], source: "estimated" as const },
      orderFlow: {
        cvd: 0,
        cvdTrend: "flat" as const,
        takerBuyRatio: 0.5,
        deltaImbalance: 0,
        source: "proxy" as const,
      },
    };
  }

  let buyVol = 0;
  let total = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    total += c.volume;
    if (c.close >= c.open) buyVol += c.volume;
  }
  const ratio = total > 0 ? buyVol / total : 0.5;
  const delta = ratio * 2 - 1;

  return {
    fundingOi: {
      fundingRate: 0.0001,
      fundingRateAvg8h: 0.0001,
      fundingTrend: "stable" as const,
      openInterest: 0,
      openInterestChange24hPct: 0,
    },
    liquidations: { levels: [], source: "estimated" as const },
    orderFlow: {
      cvd: Math.max(-1, Math.min(1, delta * 0.5)),
      cvdTrend: delta > 0.05 ? ("rising" as const) : delta < -0.05 ? ("falling" as const) : ("flat" as const),
      takerBuyRatio: ratio,
      deltaImbalance: delta,
      source: "proxy" as const,
    },
  };
}

export function buildHistoricalContext(
  coin: Coin,
  market: MarketType,
  timeframe: Timeframe,
  allCandles: Record<string, Candle[]>,
  asOf: number
): { context: AnalysisContext; snapshot: AnalysisSnapshot } | null {
  const config = TIMEFRAME_CANDLE_CONFIG[timeframe];
  const candles = buildCandleMapAtTime(allCandles, timeframe, asOf);
  const primaryInterval = config.primaryInterval;
  const primaryCandles = candles[primaryInterval] ?? [];

  if (primaryCandles.length < 30) return null;

  const indicators: AnalysisContext["indicators"] = {};
  for (const [interval, candleData] of Object.entries(candles)) {
    if (candleData.length >= 20) indicators[interval] = calculateIndicators(candleData);
  }

  const marketData = buildMarketDataFromCandles(coin.symbol, primaryCandles, market);
  const marketStructure = analyzeMarketStructure(primaryCandles);
  const volumeAnalysis = analyzeVolume(primaryCandles);
  const volatility = calculateVolatility(primaryCandles);
  const srLevels = calculateLevels(primaryCandles, marketData.price);
  const onChainFlow = market === "Futures" ? proxyOrderFlow(primaryCandles) : undefined;

  const contextBase: AnalysisContext = {
    coin,
    market,
    timeframe,
    marketData,
    candles,
    indicators,
    marketStructure,
    volumeAnalysis,
    volatility,
    levels: srLevels,
    news: NEUTRAL_NEWS,
    fearGreed: NEUTRAL_MACRO.fearGreed,
    btcDominance: NEUTRAL_MACRO.btcDominance,
    globalMarket: NEUTRAL_MACRO.globalMarket,
    onChainFlow,
  };

  const snapshotPartial: AnalysisSnapshot = {
    indicators,
    marketData,
    marketStructure,
    volumeAnalysis,
    volatility,
    levels: srLevels,
    news: NEUTRAL_NEWS,
    fearGreed: NEUTRAL_MACRO.fearGreed,
    btcDominance: NEUTRAL_MACRO.btcDominance,
    globalMarket: NEUTRAL_MACRO.globalMarket,
    primaryTimeframe: primaryInterval,
    onChainFlow,
  };

  const marketRegime = detectMarketRegimeWithGuards(contextBase, snapshotPartial);
  const snapshot: AnalysisSnapshot = { ...snapshotPartial, marketRegime };
  const context: AnalysisContext = { ...contextBase, marketRegime };

  return { context, snapshot };
}
