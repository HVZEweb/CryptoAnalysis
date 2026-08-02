import { fetchCandles as fetchBinanceCandles, fetchMarketData } from "@/services/binance";
import { getIntervalsForTimeframe, aggregateCandles } from "@/lib/timeframe";
import type { Candle, MarketType, Timeframe } from "@/types";

export async function fetchCandlesForTimeframe(
  symbol: string,
  market: MarketType,
  timeframe: Timeframe
): Promise<Record<string, Candle[]>> {
  const { fetchIntervals, configs } = getIntervalsForTimeframe(timeframe);
  const results = await Promise.all(
    fetchIntervals.map(async (interval) => {
      try {
        const candles = await fetchBinanceCandles(symbol, interval, market);
        return [interval, candles] as const;
      } catch {
        return [interval, []] as const;
      }
    })
  );

  const candleMap = Object.fromEntries(results) as Record<string, Candle[]>;

  if (configs.aggregateFrom && configs.aggregateCount) {
    const source = candleMap[configs.aggregateFrom] ?? [];
    if (source.length >= configs.aggregateCount) {
      candleMap[configs.primaryInterval] = aggregateCandles(source, configs.aggregateCount);
    }
  }

  return candleMap;
}

export { fetchMarketData };
