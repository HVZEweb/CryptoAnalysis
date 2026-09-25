/**
 * Train the pooled model (candles + futures positioning, ~30 coins) from the Binance public archive.
 * Runs weekly in GitHub Actions (.github/workflows/train-models.yml); the server downloads the result.
 *
 *   npm run pooled:train                                   # 2 years, 1h and 4h, into models/pooled
 *   npm run pooled:train -- --out out/pooled --days 365 --symbols BTC,ETH
 */

import fs from "fs";
import path from "path";
import type { Timeframe } from "@/types";
import { HORIZONS } from "@/services/predictor/config";
import { trainPredictor } from "@/services/predictor/train";
import { describeModel } from "@/services/predictor/training-run";
import { loadPooledDataset } from "@/services/pooled/dataset";
import { computePooledFeatureSeries, POOLED_FEATURE_NAMES } from "@/services/pooled/features";
import { POOLED_TIMEFRAMES, POOLED_UNIVERSE, savePooledModel } from "@/services/pooled/index";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const out = arg("out") ?? path.join(process.cwd(), "models", "pooled");
const cacheDir = arg("cache") ?? path.join(process.cwd(), "data", "archive");
const days = Number(arg("days") ?? 730);
const timeframes = (arg("timeframes")?.split(",") as Timeframe[] | undefined) ?? POOLED_TIMEFRAMES;
const symbols =
  arg("symbols")
    ?.split(",")
    .map((s) => s.toUpperCase().replace(/USDT$/, "") + "USDT") ?? POOLED_UNIVERSE;

async function main() {
  const log = (line: string) => console.log(line);
  // Every pooled timeframe uses the same bar interval, so data is loaded once.
  const intervals = [...new Set(timeframes.map((tf) => HORIZONS[tf].interval))];
  if (intervals.length !== 1) throw new Error(`разные интервалы баров: ${intervals.join(", ")}`);
  const { series, derivs, btc } = await loadPooledDataset(symbols, intervals[0], days, cacheDir, log);

  const summary: string[] = [];
  for (const timeframe of timeframes) {
    const spec = HORIZONS[timeframe];
    log(`\n[${timeframe}] бары ${spec.interval}, горизонт ${spec.horizon}, монет ${series.length}`);
    const model = trainPredictor(timeframe, series, "binance-archive", {
      btc,
      log,
      features: {
        names: POOLED_FEATURE_NAMES,
        set: "pooled",
        compute: (symbol, candles) =>
          computePooledFeatureSeries(candles, { btc: symbol === "BTCUSDT" ? candles : btc, derivs: derivs.get(symbol)! }),
      },
    });
    const text = describeModel(model);
    log(text);
    const by = Object.entries(model.strategy?.bySymbol ?? {})
      .sort((a, b) => b[1].avgNetBp - a[1].avgNetBp)
      .map(([s, m]) => `    ${s.padEnd(10)} ${String(m.trades).padStart(4)} сделок, ${m.avgNetBp >= 0 ? "+" : ""}${m.avgNetBp.toFixed(1)} п./сделку`);
    if (by.length) log(`  по монетам на проверочном периоде:\n${by.join("\n")}`);
    log(`  сохранено: ${savePooledModel(model, out)}`);
    summary.push(`### ${timeframe}\n\`\`\`\n${text}\n${by.join("\n")}\n\`\`\``);
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n\n") + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
