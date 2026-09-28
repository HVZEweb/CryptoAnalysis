/** Live Binance USDT-perpetual data for the funding forward test: daily bars and funding settlements. */

import { binanceFuturesClient } from "@/lib/axios";
import { DAY } from "@/services/funding-carry/rule";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** USDT perpetuals trading now. */
export async function usdtPerpetuals(): Promise<string[]> {
  const { data } = await binanceFuturesClient.get<{ symbols: Array<{ symbol: string; contractType: string; quoteAsset: string; status: string }> }>(
    "/exchangeInfo",
    { timeout: 30_000 }
  );
  return data.symbols.filter((s) => s.contractType === "PERPETUAL" && s.quoteAsset === "USDT" && s.status === "TRADING").map((s) => s.symbol);
}

/** Closed daily bars with open time in [from, to] (UTC day starts): close and quote volume by day. */
export async function dailyBars(symbol: string, from: number, to: number): Promise<{ close: Map<number, number>; volume: Map<number, number> }> {
  const { data } = await binanceFuturesClient.get<Array<[number, string, string, string, string, string, number, string]>>("/klines", {
    params: { symbol, interval: "1d", startTime: from, endTime: to + DAY - 1, limit: 100 },
  });
  const close = new Map<number, number>();
  const volume = new Map<number, number>();
  for (const k of data) {
    if (k[6] >= Date.now()) continue; // still forming
    close.set(k[0], Number(k[4]));
    volume.set(k[0], Number(k[7]));
  }
  return { close, volume };
}

/** Funding settled during each UTC day in [from, to]. */
export async function dailyFunding(symbol: string, from: number, to: number): Promise<Map<number, number>> {
  const { data } = await binanceFuturesClient.get<Array<{ fundingTime: number; fundingRate: string }>>("/fundingRate", {
    params: { symbol, startTime: from, endTime: to + DAY - 1, limit: 1000 },
  });
  const out = new Map<number, number>();
  for (const f of data) {
    const day = f.fundingTime - (f.fundingTime % DAY);
    out.set(day, (out.get(day) ?? 0) + Number(f.fundingRate));
  }
  return out;
}

/** Runs `fn` over `items` a few at a time with a short pause, to stay far below Binance's rate limits. */
export async function gently<T, R>(items: T[], fn: (item: T) => Promise<R>, parallel = 4): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(items.length).fill(null);
  for (let i = 0; i < items.length; i += parallel) {
    await Promise.all(items.slice(i, i + parallel).map((item, j) => fn(item).then((r) => (out[i + j] = r)).catch(() => null)));
    await pause(100);
  }
  return out;
}
