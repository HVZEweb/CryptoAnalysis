/**
 * Train the price predictor and print its walk-forward validation.
 *
 *   npm run predictor:train                       # Binance, 5 coins, all timeframes
 *   npm run predictor:train -- --source csv       # data/ohlcv/*.csv (no network needed)
 *   npm run predictor:train -- --timeframes 1h,4h --symbols BTC,ETH --days 730
 */

import type { Timeframe } from "@/types";
import { installOutboundProxy } from "@/lib/outbound-proxy";
import { trainAll } from "@/services/predictor/training-run";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const source = arg("source") === "csv" ? "csv" : "binance";
const timeframes = arg("timeframes")?.split(",") as Timeframe[] | undefined;
const symbols = arg("symbols")
  ?.split(",")
  .map((s) => s.toUpperCase().replace(/USDT$/, "") + "USDT");
const days = arg("days") ? Number(arg("days")) : undefined;

installOutboundProxy()
  .then(() => trainAll({ source, timeframes, symbols, days, log: console.log }))
  .then((models) => {
    console.log(`\nГотово: обучено моделей ${models.length}.`);
    process.exit(models.length ? 0 : 1);
  });
