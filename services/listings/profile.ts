/**
 * A short profile of a newly listed coin: where else it trades (Binance) and what CoinGecko knows
 * (market cap, fully diluted value, share of supply in circulation, categories). Best effort —
 * each part is skipped when its source doesn't answer.
 */

import { binanceClient, binanceFuturesClient, coingeckoClient } from "@/lib/axios";

export interface CoinProfile {
  binanceSpot: boolean | null;
  binanceFutures: boolean | null;
  binancePrice: number | null;
  coingecko: {
    id: string;
    name: string;
    /** Several coins share the ticker: the largest one was taken */
    ambiguous: boolean;
    rank: number | null;
    marketCap: number | null;
    fdv: number | null;
    /** circulating / total supply */
    circulatingShare: number | null;
    categories: string[];
    homepage: string | null;
  } | null;
}

async function binancePrice(client: typeof binanceClient, symbol: string): Promise<number | null | false> {
  try {
    const { data } = await client.get<{ price: string }>("/ticker/price", { params: { symbol }, timeout: 8_000 });
    return Number(data.price);
  } catch (e) {
    return (e as { response?: { status?: number } }).response?.status === 400 ? false : null;
  }
}

export async function coinProfile(base: string): Promise<CoinProfile> {
  const pair = `${base}USDT`;
  const [spot, fut] = await Promise.all([binancePrice(binanceClient, pair), binancePrice(binanceFuturesClient, pair)]);
  const profile: CoinProfile = {
    binanceSpot: spot === null ? null : spot !== false,
    binanceFutures: fut === null ? null : fut !== false,
    binancePrice: typeof spot === "number" ? spot : typeof fut === "number" ? fut : null,
    coingecko: null,
  };
  try {
    const { data } = await coingeckoClient.get<{ coins: Array<{ id: string; name: string; symbol: string; market_cap_rank: number | null }> }>("/search", {
      params: { query: base },
      timeout: 12_000,
    });
    const same = data.coins.filter((c) => c.symbol.toUpperCase() === base.toUpperCase());
    const pick = [...same].sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))[0];
    if (pick) {
      const { data: c } = await coingeckoClient.get<{
        name: string;
        market_cap_rank: number | null;
        categories: string[];
        links?: { homepage?: string[] };
        market_data?: { market_cap?: { usd?: number }; fully_diluted_valuation?: { usd?: number }; circulating_supply?: number; total_supply?: number };
      }>(`/coins/${pick.id}`, { params: { localization: false, tickers: false, community_data: false, developer_data: false }, timeout: 12_000 });
      const md = c.market_data ?? {};
      profile.coingecko = {
        id: pick.id,
        name: c.name,
        ambiguous: same.length > 1,
        rank: c.market_cap_rank,
        marketCap: md.market_cap?.usd || null,
        fdv: md.fully_diluted_valuation?.usd || null,
        circulatingShare: md.circulating_supply && md.total_supply ? md.circulating_supply / md.total_supply : null,
        categories: (c.categories ?? []).filter(Boolean).slice(0, 4),
        homepage: c.links?.homepage?.find(Boolean) ?? null,
      };
    }
  } catch {
    // CoinGecko rate limits the free API — the profile goes out without it.
  }
  return profile;
}

const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)} млрд` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)} млн` : `$${Math.round(v).toLocaleString("ru-RU")}`);

export function profileLines(p: CoinProfile): string[] {
  const lines: string[] = [];
  const where = [p.binanceSpot ? "спот" : null, p.binanceFutures ? "фьючерсы" : null].filter(Boolean);
  if (p.binanceSpot !== null || p.binanceFutures !== null) {
    lines.push(where.length ? `Binance: уже торгуется (${where.join(", ")})${p.binancePrice ? `, цена ${p.binancePrice}` : ""}` : "Binance: не торгуется");
  }
  const g = p.coingecko;
  if (g) {
    const parts = [
      g.rank ? `№${g.rank} по капитализации` : null,
      g.marketCap ? `капитализация ${usd(g.marketCap)}` : null,
      g.fdv ? `FDV ${usd(g.fdv)}` : null,
      g.circulatingShare ? `в обращении ${Math.round(g.circulatingShare * 100)}% монет` : null,
    ].filter(Boolean);
    lines.push(`CoinGecko: ${g.name}${g.ambiguous ? " (тикер неоднозначен — взята крупнейшая)" : ""}${parts.length ? ` — ${parts.join(", ")}` : ""}`);
    if (g.categories.length) lines.push(`Категории: ${g.categories.join(", ")}`);
  }
  return lines;
}
