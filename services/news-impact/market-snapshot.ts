import { fetchMarketData } from "@/services/binance";
import { fetchCVD, fetchFundingRateAndOI } from "@/services/market-data";
import { getCached, setCached } from "@/lib/cache";

export type RegimeProxy = "bull" | "bear" | "volatile" | "neutral";

export interface CoinMarketSnapshot {
  coin: string;
  fundingRate: number;
  fundingTrend: "rising" | "falling" | "stable";
  oiChange24hPct: number;
  cvdTrend: "rising" | "falling" | "flat";
  deltaImbalance: number;
  dailyVolatilityPct: number;
  priceChange24hPct: number;
  regimeProxy: RegimeProxy;
  summary: string;
}

const CACHE_TTL_MS = 90_000;

function inferRegime(
  priceChange24hPct: number,
  fundingRate: number,
  deltaImbalance: number,
  dailyVolatilityPct: number
): RegimeProxy {
  if (dailyVolatilityPct >= 4.5) return "volatile";
  if (priceChange24hPct > 2 && deltaImbalance > 0.1) return "bull";
  if (priceChange24hPct < -2 && deltaImbalance < -0.1) return "bear";
  if (fundingRate > 0.0003 && priceChange24hPct > 0) return "bull";
  if (fundingRate < -0.0001 && priceChange24hPct < 0) return "bear";
  return "neutral";
}

function buildSummary(s: Omit<CoinMarketSnapshot, "summary" | "coin">): string {
  const parts = [
    `24h ${s.priceChange24hPct > 0 ? "+" : ""}${s.priceChange24hPct.toFixed(1)}%`,
    `funding ${(s.fundingRate * 100).toFixed(3)}%`,
    `OI ${s.oiChange24hPct > 0 ? "+" : ""}${s.oiChange24hPct.toFixed(1)}%`,
    `CVD ${s.cvdTrend}`,
    `regime ${s.regimeProxy}`,
  ];
  return parts.join(" · ");
}

export async function fetchCoinMarketSnapshot(coin: string): Promise<CoinMarketSnapshot | null> {
  const cacheKey = `news-mkt:${coin}`;
  const cached = await getCached<CoinMarketSnapshot>(cacheKey);
  if (cached) return cached;

  try {
    const [market, fundingOi, orderFlow] = await Promise.all([
      fetchMarketData(coin, "Futures").catch(() => null),
      fetchFundingRateAndOI(coin).catch(() => null),
      fetchCVD(coin, "5m", 12).catch(() => null),
    ]);

    if (!market) return null;

    const dailyVolatilityPct =
      market.high24h > 0 && market.low24h > 0
        ? ((market.high24h - market.low24h) / market.price) * 100
        : Math.abs(market.priceChangePercent24h);

    const partial = {
      fundingRate: fundingOi?.fundingRate ?? market.fundingRate ?? 0,
      fundingTrend: fundingOi?.fundingTrend ?? "stable",
      oiChange24hPct: fundingOi?.openInterestChange24hPct ?? 0,
      cvdTrend: orderFlow?.cvdTrend ?? "flat",
      deltaImbalance: orderFlow?.deltaImbalance ?? 0,
      dailyVolatilityPct: Math.round(dailyVolatilityPct * 100) / 100,
      priceChange24hPct: market.priceChangePercent24h,
      regimeProxy: inferRegime(
        market.priceChangePercent24h,
        fundingOi?.fundingRate ?? 0,
        orderFlow?.deltaImbalance ?? 0,
        dailyVolatilityPct
      ),
    };

    const result: CoinMarketSnapshot = {
      coin: coin.toUpperCase(),
      ...partial,
      summary: buildSummary(partial),
    };

    await setCached(cacheKey, result, CACHE_TTL_MS);
    return result;
  } catch {
    return null;
  }
}

export function onChainAlignsWithDirection(
  snapshot: CoinMarketSnapshot | null | undefined,
  direction: "LONG" | "SHORT" | "SIDEWAYS"
): number {
  if (!snapshot || direction === "SIDEWAYS") return 0;
  let boost = 0;
  if (direction === "LONG") {
    if (snapshot.deltaImbalance > 0.12) boost += 5;
    if (snapshot.cvdTrend === "rising") boost += 3;
    if (snapshot.fundingTrend === "falling" && snapshot.fundingRate < 0) boost += 2;
    if (snapshot.deltaImbalance < -0.15) boost -= 4;
  }
  if (direction === "SHORT") {
    if (snapshot.deltaImbalance < -0.12) boost += 5;
    if (snapshot.cvdTrend === "falling") boost += 3;
    if (snapshot.fundingTrend === "rising" && snapshot.fundingRate > 0.0004) boost += 2;
    if (snapshot.deltaImbalance > 0.15) boost -= 4;
  }
  return boost;
}

export function volatilityMoveMultiplier(snapshot: CoinMarketSnapshot | null | undefined): number {
  if (!snapshot) return 1;
  const vol = snapshot.dailyVolatilityPct;
  if (vol >= 8) return 1.45;
  if (vol >= 5) return 1.25;
  if (vol >= 3) return 1.1;
  if (vol < 1.5) return 0.85;
  return 1;
}
