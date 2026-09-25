/**
 * Loads daily futures candles for the most traded USDT perpetuals and runs the cross-sectional research.
 * Used by scripts/cross-section-research.ts and the admin API.
 */

import type { Candle } from "@/types";
import { binanceFuturesClient } from "@/lib/axios";
import { fetchCandlesInRange } from "@/services/binance";
import { evaluateCrossSection, saveXsReport, type XsReport } from "@/services/cross-section/research";

const STABLES = new Set(["USDCUSDT", "FDUSDUSDT", "TUSDUSDT", "USDPUSDT", "DAIUSDT", "BUSDUSDT", "USDEUSDT"]);

export async function topPerpetuals(count: number): Promise<string[]> {
  const { data } = await binanceFuturesClient.get<Array<{ symbol: string; quoteVolume: string }>>("/ticker/24hr");
  return data
    .filter((t) => /^[A-Z0-9]+USDT$/.test(t.symbol) && !STABLES.has(t.symbol))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, count)
    .map((t) => t.symbol);
}

export async function runCrossSection(
  options: { count?: number; days?: number; log?: (line: string) => void } = {}
): Promise<{ report: XsReport; file: string }> {
  const log = options.log ?? (() => undefined);
  const symbols = await topPerpetuals(options.count ?? 50);
  const end = Date.now();
  const start = end - (options.days ?? 1095) * 86_400_000;
  const series = new Map<string, Candle[]>();
  for (const symbol of symbols) {
    try {
      const candles = (await fetchCandlesInRange(symbol, "1d", "Futures", start, end)).filter((c) => c.closeTime < end);
      if (candles.length) series.set(symbol, candles);
    } catch (e) {
      log(`  ${symbol}: ${(e as Error).message}`);
    }
  }
  log(`монет с историей: ${series.size} из ${symbols.length}`);
  const report = evaluateCrossSection(series);
  return { report, file: saveXsReport(report) };
}
