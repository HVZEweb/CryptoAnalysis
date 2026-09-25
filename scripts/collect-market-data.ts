/**
 * Collect Binance futures market data (OI, long/short ratios, taker flow, funding) into MySQL.
 * Meant to run every 5 minutes on the server; the first run backfills 30 days of 5-minute series
 * and 3 years of funding rates.
 *
 *   npm run market:collect
 *   npm run market:collect -- --top 20
 *   npm run market:collect -- --symbols BTC,ETH
 */

import { installOutboundProxy } from "@/lib/outbound-proxy";
import { getPool } from "@/lib/db";
import { collectMarketData } from "@/services/market-data/collector";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const symbols = arg("symbols")
  ?.split(",")
  .map((s) => s.trim().toUpperCase().replace(/USDT$/, "") + "USDT");
const top = Number(arg("top") ?? process.env.MARKET_DATA_TOP ?? 40);

/** The pooled model needs positioning for its coins and for every watched coin, liquid or not. */
async function extraSymbols(): Promise<string[]> {
  if (symbols) return [];
  const { POOLED_UNIVERSE } = await import("@/services/pooled/index");
  const { allWatchedSymbols } = await import("@/services/signals/store");
  return [...POOLED_UNIVERSE, ...(await allWatchedSymbols().catch(() => []))];
}

installOutboundProxy()
  .then(extraSymbols)
  .then((extra) => collectMarketData({ symbols, topCount: top, extraSymbols: extra, log: console.log }))
  .then(async (summary) => {
    await getPool().end();
    process.exit(summary.metricRows > 0 || summary.fundingRows > 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error("Сбор данных не удался:", (e as Error).message ?? e);
    await getPool().end().catch(() => undefined);
    process.exit(1);
  });
