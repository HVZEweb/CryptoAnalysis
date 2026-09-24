/**
 * Historical candles for training: local CSV files (data/ohlcv) or Binance.
 */

import fs from "fs";
import path from "path";
import { fetchCandlesInRange } from "@/services/binance";
import type { Candle, MarketType } from "@/types";

export const OHLCV_DIR = path.join(process.cwd(), "data", "ohlcv");

/** Reads `ts,open,high,low,close,volume[,...]` CSV (ts in ms). */
export function loadCsvCandles(file: string, barMinutes: number): Candle[] {
  const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [iTs, iO, iH, iL, iC, iV] = ["ts", "open", "high", "low", "close", "volume"].map(col);
  if ([iTs, iO, iH, iL, iC, iV].some((i) => i < 0)) {
    throw new Error(`${file}: expected columns ts,open,high,low,close,volume`);
  }

  const barMs = barMinutes * 60_000;
  const candles: Candle[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const p = lines[i].split(",");
    const openTime = Number(p[iTs]);
    const close = Number(p[iC]);
    const volume = Number(p[iV]);
    candles.push({
      openTime,
      open: Number(p[iO]),
      high: Number(p[iH]),
      low: Number(p[iL]),
      close,
      volume,
      closeTime: openTime + barMs - 1,
      quoteVolume: volume * close,
      trades: 0,
    });
  }
  return candles.sort((a, b) => a.openTime - b.openTime);
}

/** Groups candles into UTC-aligned buckets of `targetMinutes`; incomplete buckets are dropped. */
export function resampleCandles(candles: Candle[], sourceMinutes: number, targetMinutes: number): Candle[] {
  if (targetMinutes === sourceMinutes) return candles;
  const bucketMs = targetMinutes * 60_000;
  const perBucket = targetMinutes / sourceMinutes;
  const out: Candle[] = [];
  let current: Candle | null = null;
  let count = 0;

  const flush = () => {
    if (current && count === perBucket) out.push(current);
  };

  for (const c of candles) {
    const bucket = Math.floor(c.openTime / bucketMs) * bucketMs;
    if (!current || current.openTime !== bucket) {
      flush();
      current = { ...c, openTime: bucket, closeTime: bucket + bucketMs - 1 };
      count = 1;
      continue;
    }
    current.high = Math.max(current.high, c.high);
    current.low = Math.min(current.low, c.low);
    current.close = c.close;
    current.volume += c.volume;
    current.quoteVolume += c.quoteVolume;
    current.trades += c.trades;
    count++;
  }
  flush();
  return out;
}

export const INTERVAL_MINUTES: Record<string, number> = {
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

/** Every `<SYMBOL>_<interval>.csv` in data/ohlcv, e.g. BTCUSDT_5m.csv. */
export function listCsvSeries(dir = OHLCV_DIR): Array<{ symbol: string; file: string; minutes: number }> {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => /^([A-Z0-9]+)_(\w+)\.csv$/.exec(name))
    .filter((m): m is RegExpExecArray => !!m && INTERVAL_MINUTES[m[2]] !== undefined)
    .map((m) => ({ symbol: m[1], file: path.join(dir, m[0]), minutes: INTERVAL_MINUTES[m[2]] }));
}

export async function fetchHistory(
  symbol: string,
  interval: string,
  days: number,
  market: MarketType = "Spot"
): Promise<Candle[]> {
  const end = Date.now();
  const candles = await fetchCandlesInRange(symbol, interval, market, end - days * 86_400_000, end);
  // The newest candle is still forming — never train on it.
  return candles.filter((c) => c.closeTime < end);
}
