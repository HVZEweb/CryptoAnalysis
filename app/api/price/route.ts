import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveCoinBySymbol } from "@/lib/coins";
import { fetchMarketData } from "@/services/binance";
import type { MarketType } from "@/types";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = await checkRateLimit(`price:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Слишком много запросов" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
    );
  }

  const symbol = request.nextUrl.searchParams.get("symbol");
  const market = (request.nextUrl.searchParams.get("market") ?? "Futures") as MarketType;

  if (!symbol) {
    return NextResponse.json({ error: "Укажите symbol" }, { status: 400 });
  }

  try {
    await resolveCoinBySymbol(symbol);
    const data = await fetchMarketData(symbol, market);
    return NextResponse.json({
      symbol: symbol.toUpperCase(),
      market,
      price: data.price,
      priceChange24h: data.priceChange24h,
      priceChangePercent24h: data.priceChangePercent24h,
      high24h: data.high24h,
      low24h: data.low24h,
    });
  } catch {
    return NextResponse.json({ error: "Не удалось получить цену" }, { status: 502 });
  }
}
