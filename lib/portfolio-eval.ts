import {
  evaluatePredictionAccuracyFromPrices,
  getCandleIntervalForTimeframe,
  getTimeframeDurationMs,
} from "@/lib/accuracy";
import { resolvePriceForecast } from "@/lib/price-forecast";
import { aggregatePortfolio, simulateTrade } from "@/lib/portfolio-sim";
import { fetchCandlesInRange, fetchCurrentPrice } from "@/services/binance";
import type { MarketType, PredictionDirection, PriceForecast, Timeframe } from "@/types";

export interface PortfolioRequestItem {
  symbol: string;
  market: MarketType;
  direction: PredictionDirection;
  priceAtPrediction: number;
  timeframe?: Timeframe;
  createdAt?: string;
  priceRange?: { low: number; high: number };
  priceForecast?: PriceForecast;
  tradeLevels?: { entry: number; tp: number; sl: number; exit: number };
}

async function resolveMarketPath(item: PortfolioRequestItem) {
  const currentPrice = await fetchCurrentPrice(item.symbol, item.market);

  if (!item.createdAt || !item.timeframe) {
    return { actualPrice: currentPrice, candles: [], completed: false };
  }

  const start = new Date(item.createdAt).getTime();
  const durationMs = getTimeframeDurationMs(item.timeframe);
  const end = Math.min(start + durationMs, Date.now());
  const interval = getCandleIntervalForTimeframe(item.timeframe);

  try {
    const candles = await fetchCandlesInRange(
      item.symbol,
      interval,
      item.market,
      start,
      end
    );
    const completed = Date.now() - start >= durationMs;
    const actualPrice =
      completed && candles.length > 0 ? candles[candles.length - 1].close : currentPrice;
    return { actualPrice, candles, completed };
  } catch {
    return { actualPrice: currentPrice, candles: [], completed: false };
  }
}

export async function evaluatePortfolioItems(
  items: PortfolioRequestItem[],
  marginUsd = 100,
  leverage = 1,
  virtualStart?: number
) {
  const safeMargin = Math.max(1, marginUsd);
  const safeLeverage = Math.min(125, Math.max(1, leverage));
  const notionalUsd = safeMargin * safeLeverage;
  const startBalance = virtualStart ?? safeMargin;

  const trades = [];
  const scores: number[] = [];

  for (const item of items) {
    if (!item.priceAtPrediction || item.priceAtPrediction <= 0) continue;

    const forecast = item.priceForecast ?? resolvePriceForecast({
      direction: item.direction,
      priceAtPrediction: item.priceAtPrediction,
      priceRange: item.priceRange ?? {
        low: item.priceAtPrediction * 0.98,
        high: item.priceAtPrediction * 1.02,
      },
      tradeLevels: item.tradeLevels,
    });

    const { actualPrice, candles, completed } = await resolveMarketPath(item);

    const accuracy = evaluatePredictionAccuracyFromPrices(
      {
        direction: item.direction,
        priceAtPrediction: item.priceAtPrediction,
        timeframe: item.timeframe,
        createdAt: item.createdAt,
        priceRange: item.priceRange,
        priceForecast: forecast,
        tradeLevels: item.tradeLevels,
      },
      actualPrice,
      candles
    );

    if (accuracy.score > 0) scores.push(accuracy.score);

    const levels = item.tradeLevels ?? {
      entry: item.priceAtPrediction,
      tp: item.direction === "SHORT" ? forecast.predictedLow : forecast.predictedHigh,
      sl: item.direction === "SHORT" ? forecast.predictedHigh : forecast.predictedLow,
      exit: forecast.predictedPrice,
    };

    trades.push(
      simulateTrade(
        {
          symbol: item.symbol,
          direction: item.direction,
          timeframe: item.timeframe ?? "?",
          entry: item.priceAtPrediction,
          tp: levels.tp,
          sl: levels.sl,
          candles,
          actualPrice,
          completed,
        },
        notionalUsd
      )
    );
  }

  return {
    summary: aggregatePortfolio(trades, scores, notionalUsd, startBalance, safeMargin, safeLeverage),
    scores,
  };
}
