import { binanceClient, binanceFuturesClient, mapAxiosError, symbolToBinancePair } from "@/lib/axios";
import type { Candle, MarketData, MarketType } from "@/types";

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  count: number;
}

export async function fetchMarketData(symbol: string, market: MarketType): Promise<MarketData> {
  const pair = symbolToBinancePair(symbol, market);

  try {
    if (market === "Spot") {
      const { data } = await binanceClient.get<BinanceTicker>(`/ticker/24hr`, {
        params: { symbol: pair },
      });
      return {
        symbol: pair,
        price: parseFloat(data.lastPrice),
        priceChange24h: parseFloat(data.priceChange),
        priceChangePercent24h: parseFloat(data.priceChangePercent),
        high24h: parseFloat(data.highPrice),
        low24h: parseFloat(data.lowPrice),
        volume: parseFloat(data.volume),
        quoteVolume: parseFloat(data.quoteVolume),
        trades: data.count,
      };
    }

    const [tickerRes, fundingRes, oiRes, ratioRes] = await Promise.allSettled([
      binanceFuturesClient.get<BinanceTicker>(`/ticker/24hr`, { params: { symbol: pair } }),
      binanceFuturesClient.get<Array<{ fundingRate: string }>>(`/fundingRate`, {
        params: { symbol: pair, limit: 1 },
      }),
      binanceFuturesClient.get<{ openInterest: string }>(`/openInterest`, { params: { symbol: pair } }),
      binanceFuturesClient.get<{ longShortRatio: string }>(`/globalLongShortAccountRatio`, {
        params: { symbol: pair, period: "1h", limit: 1 },
      }),
    ]);

    if (tickerRes.status === "rejected") throw tickerRes.reason;
    const ticker = tickerRes.value.data;
    const result: MarketData = {
      symbol: pair,
      price: parseFloat(ticker.lastPrice),
      priceChange24h: parseFloat(ticker.priceChange),
      priceChangePercent24h: parseFloat(ticker.priceChangePercent),
      high24h: parseFloat(ticker.highPrice),
      low24h: parseFloat(ticker.lowPrice),
      volume: parseFloat(ticker.volume),
      quoteVolume: parseFloat(ticker.quoteVolume),
      trades: ticker.count,
    };
    if (fundingRes.status === "fulfilled" && fundingRes.value.data?.[0]) {
      result.fundingRate = parseFloat(fundingRes.value.data[0].fundingRate);
    }
    if (oiRes.status === "fulfilled") result.openInterest = parseFloat(oiRes.value.data.openInterest);
    if (ratioRes.status === "fulfilled") {
      const ratioData = ratioRes.value.data as
        | { longShortRatio: string }
        | Array<{ longShortRatio: string }>;
      const ratio =
        Array.isArray(ratioData) ? ratioData[0]?.longShortRatio : ratioData.longShortRatio;
      if (ratio) result.longShortRatio = parseFloat(ratio);
    }
    return result;
  } catch (error) {
    throw mapAxiosError(error);
  }
}

export async function fetchCandles(
  symbol: string,
  interval: string,
  market: MarketType,
  limit = 200,
  startTime?: number,
  endTime?: number
): Promise<Candle[]> {
  const pair = symbolToBinancePair(symbol, market);
  const client = market === "Futures" ? binanceFuturesClient : binanceClient;

  try {
    const params: Record<string, string | number> = { symbol: pair, interval, limit };
    if (startTime != null) params.startTime = startTime;
    if (endTime != null) params.endTime = endTime;

    const { data } = await client.get<
      Array<[number, string, string, string, string, string, number, string, number, string, string, string]>
    >("/klines", { params });

    return data.map((k) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
      quoteVolume: parseFloat(k[7]),
      trades: k[8],
    }));
  } catch (error) {
    throw mapAxiosError(error);
  }
}

export async function fetchCandlesInRange(
  symbol: string,
  interval: string,
  market: MarketType,
  startTime: number,
  endTime: number
): Promise<Candle[]> {
  const pair = symbolToBinancePair(symbol, market);
  const client = market === "Futures" ? binanceFuturesClient : binanceClient;
  const all: Candle[] = [];
  let cursor = startTime;

  try {
    while (cursor < endTime) {
      const { data } = await client.get<
        Array<[number, string, string, string, string, string, number, string, number, string, string, string]>
      >("/klines", {
        params: {
          symbol: pair,
          interval,
          startTime: cursor,
          endTime,
          limit: 1000,
        },
      });

      if (!data.length) break;

      const batch = data.map((k) => ({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: k[6],
        quoteVolume: parseFloat(k[7]),
        trades: k[8],
      }));

      all.push(...batch);
      const lastClose = batch[batch.length - 1].closeTime;
      if (lastClose <= cursor) break;
      cursor = lastClose + 1;

      if (data.length < 1000) break;
    }

    return all.filter((c) => c.openTime >= startTime && c.openTime <= endTime);
  } catch (error) {
    throw mapAxiosError(error);
  }
}

export async function fetchCurrentPrice(symbol: string, market: MarketType): Promise<number> {
  const data = await fetchMarketData(symbol, market);
  return data.price;
}
