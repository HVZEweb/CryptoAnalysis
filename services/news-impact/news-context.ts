import { fetchCandles } from "@/services/binance";
import { getCached, setCached } from "@/lib/cache";
import type { Candle } from "@/types";

export interface NewsPriceContext {
  coin: string;
  priceChange30mPct: number;
  priceChange5mPct: number;
  volatility30mPct: number;
  volumeSpike: boolean;
  priorTrend: "up" | "down" | "flat";
  summary: string;
}

const CACHE_TTL_MS = 60_000;

function calcVolatility(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    if (prev > 0) returns.push((candles[i].close - prev) / prev);
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

function pctChange(from: number, to: number): number {
  if (from <= 0) return 0;
  return ((to - from) / from) * 100;
}

function buildSummary(ctx: Omit<NewsPriceContext, "summary" | "coin">): string {
  const parts: string[] = [];
  if (Math.abs(ctx.priceChange30mPct) >= 0.15) {
    parts.push(`${ctx.priceChange30mPct > 0 ? "+" : ""}${ctx.priceChange30mPct.toFixed(2)}% за 30м`);
  } else {
    parts.push("флэт за 30м");
  }
  if (ctx.volumeSpike) parts.push("всплеск объёма");
  if (ctx.volatility30mPct >= 0.35) parts.push("повышенная волатильность");
  return parts.join(", ");
}

/** What happened with the coin in the 30 minutes before the news */
export async function fetchNewsPriceContext(coin: string): Promise<NewsPriceContext | null> {
  const cacheKey = `news-ctx:${coin}`;
  const cached = await getCached<NewsPriceContext>(cacheKey);
  if (cached) return cached;

  try {
    const candles = await fetchCandles(coin, "5m", "Futures", 8);
    if (candles.length < 3) return null;

    const first = candles[0].close;
    const last = candles[candles.length - 1].close;
    const prev = candles.length >= 2 ? candles[candles.length - 2].close : last;

    const avgVol =
      candles.slice(0, -1).reduce((s, c) => s + c.volume, 0) / Math.max(1, candles.length - 1);
    const lastVol = candles[candles.length - 1].volume;
    const volumeSpike = avgVol > 0 && lastVol > avgVol * 1.8;

    const priceChange30mPct = Math.round(pctChange(first, last) * 100) / 100;
    const priceChange5mPct = Math.round(pctChange(prev, last) * 100) / 100;
    const volatility30mPct = Math.round(calcVolatility(candles) * 100) / 100;

    let priorTrend: NewsPriceContext["priorTrend"] = "flat";
    if (priceChange30mPct > 0.2) priorTrend = "up";
    else if (priceChange30mPct < -0.2) priorTrend = "down";

    const partial = {
      priceChange30mPct,
      priceChange5mPct,
      volatility30mPct,
      volumeSpike,
      priorTrend,
    };

    const result: NewsPriceContext = {
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

export function contextAlignsWithDirection(
  ctx: NewsPriceContext | null | undefined,
  direction: "LONG" | "SHORT" | "SIDEWAYS"
): number {
  if (!ctx || direction === "SIDEWAYS") return 0;
  if (direction === "LONG") {
    if (ctx.priorTrend === "up") return 6;
    if (ctx.priorTrend === "down") return -4;
  }
  if (direction === "SHORT") {
    if (ctx.priorTrend === "down") return 6;
    if (ctx.priorTrend === "up") return -4;
  }
  return 0;
}
