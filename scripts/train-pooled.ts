/**
 * Train the pooled model (candles + futures positioning, ~30 coins) from the Binance public archive.
 * Runs weekly in GitHub Actions (.github/workflows/train-pooled.yml); the server downloads the result.
 *
 *   npm run pooled:train                                   # 2 years, 1h and 4h, into models/pooled
 *   npm run pooled:train -- --out out/pooled --days 365 --symbols BTC,ETH
 */

import fs from "fs";
import path from "path";
import type { Candle, Timeframe } from "@/types";
import { HORIZONS } from "@/services/predictor/config";
import { trainPredictor } from "@/services/predictor/train";
import { describeModel } from "@/services/predictor/training-run";
import { archiveDerivs, archiveKlines } from "@/services/pooled/archive";
import { computePooledFeatureSeries, POOLED_FEATURE_NAMES } from "@/services/pooled/features";
import { POOLED_TIMEFRAMES, POOLED_UNIVERSE, savePooledModel } from "@/services/pooled/index";
import type { DerivData, DerivPoint } from "@/services/pooled/derivs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const out = arg("out") ?? path.join(process.cwd(), "models", "pooled");
const cacheDir = arg("cache") ?? path.join(process.cwd(), "data", "archive");
const days = Number(arg("days") ?? 730);
const timeframes = (arg("timeframes")?.split(",") as Timeframe[] | undefined) ?? POOLED_TIMEFRAMES;
const symbols =
  arg("symbols")
    ?.split(",")
    .map((s) => s.toUpperCase().replace(/USDT$/, "") + "USDT") ?? POOLED_UNIVERSE;

/**
 * Funding is only archived by whole months, so training stops at the start of the current month:
 * every series is then complete up to the last bar.
 */
const now = new Date();
const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1;
const from = to - days * DAY;

/** Only the last snapshot of each hour can be used by an hourly model; the rest would just fill memory. */
function thinToHourly(points: DerivPoint[]): DerivPoint[] {
  const byHour = new Map<number, DerivPoint>();
  // alignDerivs takes the last snapshot at or before :55 of a bar's hour — the latest one within that hour.
  for (const p of points) {
    const key = p.ts - (p.ts % HOUR);
    const prev = byHour.get(key);
    if (!prev || p.ts > prev.ts) byHour.set(key, p);
  }
  return [...byHour.values()].sort((a, b) => a.ts - b.ts);
}

async function main() {
  const log = (line: string) => console.log(line);
  const opts = { cacheDir, concurrency: 12, log };
  log(`Период: ${new Date(from).toISOString().slice(0, 10)} → ${new Date(to).toISOString().slice(0, 10)}, монет: ${symbols.length}`);

  // Every pooled timeframe uses the same bar interval, so data is loaded once.
  const intervals = [...new Set(timeframes.map((tf) => HORIZONS[tf].interval))];
  if (intervals.length !== 1) throw new Error(`разные интервалы баров: ${intervals.join(", ")}`);
  const interval = intervals[0];

  const series: Array<{ symbol: string; candles: Candle[] }> = [];
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
