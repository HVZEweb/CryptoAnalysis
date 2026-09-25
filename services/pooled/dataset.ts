/**
 * The pooled dataset from the Binance archive: futures candles and hourly positioning for many coins.
 * Shared by the pooled model training (scripts/train-pooled.ts) and research (scripts/research.ts).
 */

import type { Candle } from "@/types";
import { archiveDerivs, archiveKlines } from "@/services/pooled/archive";
import type { DerivData, DerivPoint } from "@/services/pooled/derivs";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface PooledDataset {
  from: number;
  to: number;
  series: Array<{ symbol: string; candles: Candle[] }>;
  derivs: Map<string, DerivData>;
  btc: Candle[];
}

/** Only the last snapshot of each hour can be used by an hourly model; the rest would just fill memory. */
export function thinToHourly(points: DerivPoint[]): DerivPoint[] {
  const byHour = new Map<number, DerivPoint>();
  // alignDerivs takes the last snapshot at or before :55 of a bar's hour — the latest one within that hour.
  for (const p of points) {
    const key = p.ts - (p.ts % HOUR);
    const prev = byHour.get(key);
    if (!prev || p.ts > prev.ts) byHour.set(key, p);
  }
  return [...byHour.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Funding is only archived by whole months, so data stops at the start of the current month:
 * every series is then complete up to the last bar.
 */
export function datasetPeriod(days: number, now = new Date()): { from: number; to: number } {
  const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1;
  return { from: to - days * DAY, to };
}

export async function loadPooledDataset(
  symbols: string[],
  interval: string,
  days: number,
  cacheDir: string,
  log: (line: string) => void = () => undefined
): Promise<PooledDataset> {
  const { from, to } = datasetPeriod(days);
  const opts = { cacheDir, concurrency: 12, log };
  log(`Период: ${new Date(from).toISOString().slice(0, 10)} → ${new Date(to).toISOString().slice(0, 10)}, монет: ${symbols.length}`);
  const series: PooledDataset["series"] = [];
  const derivs = new Map<string, DerivData>();
  for (const symbol of symbols) {
    const t0 = Date.now();
    try {
      const candles = await archiveKlines(symbol, interval, from, to, opts);
      const d = await archiveDerivs(symbol, from, to, opts);
      if (candles.length < 2000 || d.points.length < 1000) {
        log(`  ${symbol}: мало данных (свечей ${candles.length}, снимков ${d.points.length}) — пропуск`);
        continue;
      }
      series.push({ symbol, candles });
      derivs.set(symbol, { points: thinToHourly(d.points), funding: d.funding });
      log(`  ${symbol}: свечей ${candles.length}, снимков ${d.points.length}, фандингов ${d.funding.length} (${((Date.now() - t0) / 1000).toFixed(0)} с)`);
    } catch (e) {
      log(`  ${symbol}: ${(e as Error).message}`);
    }
  }
  const btc = series.find((s) => s.symbol === "BTCUSDT")?.candles;
  if (!btc) throw new Error("нет свечей BTC");
  return { from, to, series, derivs, btc };
}
