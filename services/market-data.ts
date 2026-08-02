import axios from "axios";
import { coingeckoClient, binanceFuturesClient, binanceFuturesDataClient, symbolToBinancePair } from "@/lib/axios";
import { getCached, setCached } from "@/lib/cache";
import type {
  BtcDominance,
  Candle,
  FearGreedIndex,
  FundingOiData,
  GlobalMarket,
  LiquidationData,
  LiquidationLevel,
  MarketType,
  NewsItem,
  NewsSummary,
  OnChainFlowData,
  OrderFlowData,
} from "@/types";
import { processNewsItems, scoreTextLexicon } from "@/services/sentiment";

const alternativeClient = axios.create({
  baseURL: "https://api.alternative.me",
  timeout: 10000,
});

const RSS_FEEDS = [
  "https://www.coindesk.com/arc/outboundfeeds/rss/",
  "https://cointelegraph.com/rss",
];

function analyzeSentiment(title: string): NewsItem["sentiment"] {
  return scoreTextLexicon(title).label;
}

function parseRssItems(xml: string, symbol: string, coinName: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const titleRegex = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
  const linkRegex = /<link>([\s\S]*?)<\/link>/i;
  const dateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/i;

  const keywords = [symbol.toLowerCase(), coinName.toLowerCase(), "crypto", "bitcoin", "ethereum"];
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && items.length < 15) {
    const block = match[1];
    const titleMatch = block.match(titleRegex);
    if (!titleMatch) continue;
    const title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
    const lowerTitle = title.toLowerCase();
    const relevant = keywords.some((k) => lowerTitle.includes(k));
    if (!relevant && symbol !== "BTC" && symbol !== "ETH") continue;

    const linkMatch = block.match(linkRegex);
    const dateMatch = block.match(dateRegex);
    items.push({
      title,
      source: linkMatch?.[1]?.includes("coindesk") ? "CoinDesk" : "CoinTelegraph",
      publishedAt: dateMatch?.[1] ? new Date(dateMatch[1]).toISOString() : new Date().toISOString(),
      sentiment: analyzeSentiment(title),
    });
  }

  return items;
}

async function fetchRssNews(symbol: string, coinName: string): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    RSS_FEEDS.map((url) => axios.get<string>(url, { timeout: 8000, responseType: "text" }))
  );

  const items: NewsItem[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      items.push(...parseRssItems(result.value.data, symbol, coinName));
    }
  }

  return items.slice(0, 10);
}

export async function fetchFearGreedIndex(): Promise<FearGreedIndex> {
  try {
    const { data } = await alternativeClient.get<{
      data: Array<{ value: string; value_classification: string }>;
    }>("/fng/");
    const latest = data.data?.[0];
    if (!latest) return { value: 50, classification: "Neutral" };
    return { value: parseInt(latest.value, 10), classification: latest.value_classification };
  } catch {
    return { value: 50, classification: "Neutral" };
  }
}

const GLOBAL_CACHE_TTL_MS = 60_000;
let globalMarketCache: {
  at: number;
  dominance: number;
  totalMarketCap: number;
  totalVolume: number;
  marketCapChange24h: number;
} | null = null;

async function fetchCoingeckoGlobal() {
  if (globalMarketCache && Date.now() - globalMarketCache.at < GLOBAL_CACHE_TTL_MS) {
    return globalMarketCache;
  }
  const { data } = await coingeckoClient.get<{
    data: {
      market_cap_percentage: { btc: number };
      total_market_cap: { usd: number };
      total_volume: { usd: number };
      market_cap_change_percentage_24h_usd: number;
    };
  }>("/global");
  const g = data.data;
  globalMarketCache = {
    at: Date.now(),
    dominance: g.market_cap_percentage.btc,
    totalMarketCap: g.total_market_cap.usd,
    totalVolume: g.total_volume.usd,
    marketCapChange24h: g.market_cap_change_percentage_24h_usd,
  };
  return globalMarketCache;
}

export async function fetchBtcDominance(): Promise<BtcDominance> {
  try {
    const g = await fetchCoingeckoGlobal();
    const prev = await getCached<{ dominance: number }>("btc-dominance-prev");
    const change24h = prev ? g.dominance - prev.dominance : 0;

    await setCached("btc-dominance-prev", { dominance: g.dominance }, 24 * 60 * 60 * 1000);
    return { dominance: g.dominance, change24h };
  } catch {
    return { dominance: 0, change24h: 0 };
  }
}

export async function fetchGlobalMarket(): Promise<GlobalMarket> {
  try {
    const g = await fetchCoingeckoGlobal();
    return {
      totalMarketCap: g.totalMarketCap,
      totalVolume: g.totalVolume,
      marketCapChange24h: g.marketCapChange24h,
    };
  } catch {
    return { totalMarketCap: 0, totalVolume: 0, marketCapChange24h: 0 };
  }
}

function buildNewsSummary(items: NewsItem[]): NewsSummary {
  const positive = items.filter((i) => i.sentiment === "positive").length;
  const negative = items.filter((i) => i.sentiment === "negative").length;
  const neutral = items.filter((i) => i.sentiment === "neutral").length;
  let summary = "Нейтральный новостной фон.";
  if (positive > negative) summary = "Преобладают позитивные новости.";
  else if (negative > positive) summary = "Преобладают негативные новости.";
  return {
    items,
    positive,
    negative,
    neutral,
    summary,
    aggregateScore: (positive - negative) / Math.max(1, items.length),
    sentimentSource: "lexicon",
  };
}

export async function fetchNews(coinId: string, coinName: string, symbol: string): Promise<NewsSummary> {
  const fallback: NewsItem[] = [
    {
      title: `Активность рынка ${coinName} отслеживается трейдерами`,
      source: "Market Watch",
      publishedAt: new Date().toISOString(),
      sentiment: "neutral",
    },
  ];

  try {
    const rssItems = await fetchRssNews(symbol, coinName);
    if (rssItems.length > 0) return processNewsItems(rssItems);

    const { data } = await coingeckoClient.get<{
      status_updates: Array<{ description: string; created_at: string; project: { name: string } }>;
    }>(`/coins/${coinId}/status_updates`, { params: { per_page: 5 } });

    const items = data.status_updates?.map((u) => ({
      title: u.description.slice(0, 150),
      source: u.project?.name ?? "CoinGecko",
      publishedAt: u.created_at,
      sentiment: analyzeSentiment(u.description),
    })) ?? fallback;

    return processNewsItems(items.length ? items : fallback);
  } catch {
    return buildNewsSummary(fallback);
  }
}

const ONCHAIN_CACHE_TTL_MS = 90_000;

function neutralFundingOi(): FundingOiData {
  return {
    fundingRate: 0,
    fundingRateAvg8h: 0,
    fundingTrend: "stable",
    openInterest: 0,
    openInterestChange24hPct: 0,
  };
}

function neutralOrderFlow(): OrderFlowData {
  return { cvd: 0, cvdTrend: "flat", takerBuyRatio: 0.5, deltaImbalance: 0, source: "proxy" };
}

function neutralLiquidations(price: number): LiquidationData {
  return { levels: [], source: "estimated", nearestLongLiq: price * 0.95, nearestShortLiq: price * 1.05 };
}

/**
 * Enhanced funding rate + open interest with 8h average and 24h OI change.
 */
export async function fetchFundingRateAndOI(symbol: string): Promise<FundingOiData> {
  const pair = symbolToBinancePair(symbol, "Futures");
  const cacheKey = `funding-oi:${pair}`;
  const cached = await getCached<FundingOiData>(cacheKey);
  if (cached) return cached;

  try {
    const [fundingRes, oiRes, oiHistRes, ratioRes, premiumRes] = await Promise.allSettled([
      binanceFuturesClient.get<Array<{ fundingRate: string; fundingTime: number }>>(`/fundingRate`, {
        params: { symbol: pair, limit: 8 },
      }),
      binanceFuturesClient.get<{ openInterest: string }>(`/openInterest`, { params: { symbol: pair } }),
      binanceFuturesDataClient.get<Array<{ sumOpenInterest: string; timestamp: number }>>(`/openInterestHist`, {
        params: { symbol: pair, period: "1h", limit: 24 },
      }),
      binanceFuturesDataClient.get<Array<{ longShortRatio: string }>>(`/globalLongShortAccountRatio`, {
        params: { symbol: pair, period: "1h", limit: 1 },
      }),
      binanceFuturesClient.get<{ markPrice: string; lastFundingRate: string; nextFundingTime: number }>(
        `/premiumIndex`,
        { params: { symbol: pair } }
      ),
    ]);

    const fundingRates =
      fundingRes.status === "fulfilled"
        ? fundingRes.value.data.map((f) => parseFloat(f.fundingRate))
        : [];
    const fundingRate = fundingRates[0] ?? 0;
    const fundingRateAvg8h =
      fundingRates.length > 0
        ? fundingRates.reduce((a, b) => a + b, 0) / fundingRates.length
        : fundingRate;

    let fundingTrend: FundingOiData["fundingTrend"] = "stable";
    if (fundingRates.length >= 3) {
      const recent = fundingRates.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
      const older = fundingRates.slice(3, 6).reduce((a, b) => a + b, 0) / Math.max(1, fundingRates.slice(3, 6).length);
      if (recent > older * 1.15) fundingTrend = "rising";
      else if (recent < older * 0.85) fundingTrend = "falling";
    }

    const openInterest =
      oiRes.status === "fulfilled" ? parseFloat(oiRes.value.data.openInterest) : 0;

    let openInterestChange24hPct = 0;
    if (oiHistRes.status === "fulfilled" && oiHistRes.value.data.length >= 2) {
      const hist = oiHistRes.value.data;
      const latest = parseFloat(hist[hist.length - 1].sumOpenInterest);
      const prev = parseFloat(hist[0].sumOpenInterest);
      if (prev > 0) openInterestChange24hPct = ((latest - prev) / prev) * 100;
    }

    const longShortRatio =
      ratioRes.status === "fulfilled" && ratioRes.value.data[0]
        ? parseFloat(ratioRes.value.data[0].longShortRatio)
        : undefined;

    const markPrice =
      premiumRes.status === "fulfilled" ? parseFloat(premiumRes.value.data.markPrice) : undefined;
    const nextFundingTime =
      premiumRes.status === "fulfilled"
        ? new Date(premiumRes.value.data.nextFundingTime).toISOString()
        : undefined;

    const result: FundingOiData = {
      fundingRate,
      fundingRateAvg8h,
      fundingTrend,
      openInterest,
      openInterestChange24hPct,
      longShortRatio,
      markPrice,
      nextFundingTime,
    };

    await setCached(cacheKey, result, ONCHAIN_CACHE_TTL_MS);
    return result;
  } catch {
    return neutralFundingOi();
  }
}

/**
 * Liquidation clusters — Coinglass API if key set, else leverage-based estimate from swings.
 */
export async function fetchLiquidationLevels(
  symbol: string,
  price: number,
  candles: Candle[]
): Promise<LiquidationData> {
  const pair = symbolToBinancePair(symbol, "Futures");
  const apiKey = process.env.COINGLASS_API_KEY?.trim();

  if (apiKey) {
    try {
      const { data } = await axios.get<{
        data?: Array<{ price: number; side: string; volume: number }>;
      }>("https://open-api-v4.coinglass.com/api/futures/liquidation/map", {
        params: { symbol: pair.replace("USDT", ""), exchange: "Binance" },
        headers: { "CG-API-KEY": apiKey },
        timeout: 10000,
      });

      const raw = data.data ?? [];
      if (raw.length > 0) {
        const levels: LiquidationLevel[] = raw.slice(0, 12).map((l) => ({
          price: l.price,
          side: l.side?.toLowerCase().includes("long") ? "long" : "short",
          estimatedUsd: l.volume,
          distancePct: price > 0 ? ((l.price - price) / price) * 100 : 0,
        }));
        const longLiq = levels.filter((l) => l.side === "long" && l.price < price).sort((a, b) => b.price - a.price)[0];
        const shortLiq = levels.filter((l) => l.side === "short" && l.price > price).sort((a, b) => a.price - b.price)[0];
        return {
          levels,
          nearestLongLiq: longLiq?.price,
          nearestShortLiq: shortLiq?.price,
          totalEstimatedUsd24h: levels.reduce((s, l) => s + (l.estimatedUsd ?? 0), 0),
          source: "coinglass",
        };
      }
    } catch {
      // fall through to proxy
    }
  }

  return estimateLiquidationLevels(price, candles);
}

function estimateLiquidationLevels(price: number, candles: Candle[]): LiquidationData {
  if (!candles.length || price <= 0) return neutralLiquidations(price);

  const recent = candles.slice(-48);
  const swingLow = Math.min(...recent.map((c) => c.low));
  const swingHigh = Math.max(...recent.map((c) => c.high));

  const leverages = [
    { lev: 10, pct: 0.1 },
    { lev: 25, pct: 0.04 },
    { lev: 50, pct: 0.02 },
  ];

  const levels: LiquidationLevel[] = [];
  for (const { lev, pct } of leverages) {
    const longPrice = swingLow * (1 - pct);
    const shortPrice = swingHigh * (1 + pct);
    levels.push({
      price: longPrice,
      side: "long",
      distancePct: ((longPrice - price) / price) * 100,
      estimatedUsd: undefined,
    });
    levels.push({
      price: shortPrice,
      side: "short",
      distancePct: ((shortPrice - price) / price) * 100,
      estimatedUsd: undefined,
    });
  }

  const nearestLongLiq = levels
    .filter((l) => l.side === "long" && l.price < price)
    .sort((a, b) => b.price - a.price)[0]?.price;
  const nearestShortLiq = levels
    .filter((l) => l.side === "short" && l.price > price)
    .sort((a, b) => a.price - b.price)[0]?.price;

  return {
    levels,
    nearestLongLiq,
    nearestShortLiq,
    source: candles.length >= 20 ? "binance_proxy" : "estimated",
  };
}

/**
 * CVD + delta imbalance from Binance taker buy/sell on futures klines.
 */
export async function fetchCVD(symbol: string, interval = "1h", limit = 48): Promise<OrderFlowData> {
  const pair = symbolToBinancePair(symbol, "Futures");
  const cacheKey = `cvd:${pair}:${interval}`;
  const cached = await getCached<OrderFlowData>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await binanceFuturesClient.get<
      Array<[number, string, string, string, string, string, number, string, number, string, string, string]>
    >("/klines", { params: { symbol: pair, interval, limit } });

    if (!data.length) return neutralOrderFlow();

    let cvdRaw = 0;
    let totalVol = 0;
    let buyVol = 0;
    const cvdSeries: number[] = [];

    for (const k of data) {
      const vol = parseFloat(k[5]);
      const takerBuy = parseFloat(k[9]);
      const delta = 2 * takerBuy - vol;
      cvdRaw += delta;
      cvdSeries.push(cvdRaw);
      totalVol += vol;
      buyVol += takerBuy;
    }

    const takerBuyRatio = totalVol > 0 ? buyVol / totalVol : 0.5;
    const deltaImbalance = totalVol > 0 ? (2 * buyVol - totalVol) / totalVol : 0;

    const recent = cvdSeries.slice(-6);
    const older = cvdSeries.slice(-12, -6);
    const rAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    const oAvg = older.length ? older.reduce((a, b) => a + b, 0) / older.length : 0;
    let cvdTrend: OrderFlowData["cvdTrend"] = "flat";
    if (rAvg > oAvg * 1.05) cvdTrend = "rising";
    else if (rAvg < oAvg * 0.95) cvdTrend = "falling";

    const denom = totalVol || 1;
    const cvd = Math.max(-1, Math.min(1, cvdRaw / denom));

    const result: OrderFlowData = {
      cvd,
      cvdTrend,
      takerBuyRatio,
      deltaImbalance: Math.max(-1, Math.min(1, deltaImbalance)),
      source: "binance",
    };

    await setCached(cacheKey, result, ONCHAIN_CACHE_TTL_MS);
    return result;
  } catch {
    return neutralOrderFlow();
  }
}

/**
 * Aggregate on-chain / order-flow snapshot for Futures; neutral on Spot.
 */
export async function fetchOnChainFlow(
  symbol: string,
  market: MarketType,
  price: number,
  candles: Candle[]
): Promise<OnChainFlowData> {
  if (market !== "Futures") {
    return {
      fundingOi: neutralFundingOi(),
      liquidations: neutralLiquidations(price),
      orderFlow: neutralOrderFlow(),
    };
  }

  const [fundingOi, liquidations, orderFlow] = await Promise.all([
    fetchFundingRateAndOI(symbol),
    fetchLiquidationLevels(symbol, price, candles),
    fetchCVD(symbol),
  ]);

  return { fundingOi, liquidations, orderFlow };
}
