import { getCached, setCached } from "@/lib/cache";
import { coingeckoClient, binanceClient, mapAxiosError } from "@/lib/axios";
import type { Coin } from "@/types";

const CACHE_KEY = "coins-list";
const CACHE_TTL = 6 * 60 * 60 * 1000;

export const CANONICAL_COIN_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
  TON: "the-open-network",
  ADA: "cardano",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  MATIC: "matic-network",
  SHIB: "shiba-inu",
  LTC: "litecoin",
  TRX: "tron",
  ATOM: "cosmos",
  NEAR: "near",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
};

function dedupeCoinsBySymbol(coins: Coin[]): Coin[] {
  const bySymbol = new Map<string, Coin>();

  for (const coin of coins) {
    const existing = bySymbol.get(coin.symbol);
    const canonicalId = CANONICAL_COIN_IDS[coin.symbol];

    if (!existing) {
      bySymbol.set(coin.symbol, coin);
      continue;
    }

    if (canonicalId && coin.id === canonicalId) {
      bySymbol.set(coin.symbol, coin);
    } else if (!canonicalId && existing.id !== canonicalId && coin.name.length < existing.name.length) {
      bySymbol.set(coin.symbol, coin);
    }
  }

  return Array.from(bySymbol.values());
}

async function fetchCoinsFromApi(): Promise<Coin[]> {
  const [coingeckoRes, binanceRes, marketsRes] = await Promise.all([
    coingeckoClient.get<Array<{ id: string; symbol: string; name: string }>>("/coins/list"),
    binanceClient.get<{
      symbols: Array<{ symbol: string; baseAsset: string; quoteAsset: string; status: string }>;
    }>("/exchangeInfo"),
    coingeckoClient.get<Array<{ id: string; symbol: string; image: string }>>("/coins/markets", {
      params: {
        vs_currency: "usd",
        order: "market_cap_desc",
        per_page: 250,
        sparkline: false,
      },
    }),
  ]);

  const imageMap = new Map(
    marketsRes.data.map((m) => [m.id, m.image] as const)
  );

  const usdtPairs = new Set(
    binanceRes.data.symbols
      .filter((s) => s.quoteAsset === "USDT" && s.status === "TRADING")
      .map((s) => s.baseAsset.toUpperCase())
  );

  const coins: Coin[] = coingeckoRes.data
    .filter((c) => usdtPairs.has(c.symbol.toUpperCase()))
    .map((c) => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      image: imageMap.get(c.id),
    }));

  const deduped = dedupeCoinsBySymbol(coins);
  const priority = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "TON", "ADA", "AVAX", "DOT"];

  deduped.sort((a, b) => {
    const aIdx = priority.indexOf(a.symbol);
    const bIdx = priority.indexOf(b.symbol);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.name.localeCompare(b.name);
  });

  return deduped;
}

export async function getCoins(): Promise<Coin[]> {
  const cached = await getCached<Coin[]>(CACHE_KEY);
  if (cached) return cached;

  try {
    const coins = await fetchCoinsFromApi();
    await setCached(CACHE_KEY, coins, CACHE_TTL);
    return coins;
  } catch (error) {
    throw mapAxiosError(error);
  }
}

export async function resolveCoinBySymbol(symbol: string): Promise<Coin> {
  const normalized = symbol.toUpperCase().trim();
  const coins = await getCoins();
  const canonicalId = CANONICAL_COIN_IDS[normalized];

  const match = coins.find(
    (c) =>
      c.symbol === normalized &&
      (canonicalId ? c.id === canonicalId : true)
  ) ?? coins.find((c) => c.symbol === normalized);

  if (!match) {
    throw {
      code: "VALIDATION_ERROR",
      message: `Монета ${normalized} не найдена на Binance USDT.`,
    };
  }

  return match;
}
