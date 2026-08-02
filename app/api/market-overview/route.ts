import { NextResponse } from "next/server";
import { fetchBtcDominance, fetchFearGreedIndex, fetchGlobalMarket } from "@/services/market-data";
import { fetchMarketData } from "@/services/binance";

export const revalidate = 60;

const TOP_COINS = ["BTC", "ETH", "SOL"] as const;

export async function GET() {
  const [fearGreed, btcDominance, globalMarket, coinResults] = await Promise.all([
    fetchFearGreedIndex(),
    fetchBtcDominance(),
    fetchGlobalMarket(),
    Promise.allSettled(
      TOP_COINS.map((symbol) =>
        fetchMarketData(symbol, "Futures").then((data) => ({
          symbol,
          price: data.price,
          change24h: data.priceChangePercent24h,
        }))
      )
    ),
  ]);

  const topCoins = coinResults
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

  return NextResponse.json(
    {
      fearGreed,
      btcDominance,
      globalMarket,
      topCoins,
      updatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "public, s-maxage=60" } }
  );
}
