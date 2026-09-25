/**
 * Research run on the Binance archive: rare positioning events and "big move" models, both judged
 * after realistic costs on a holdout period (services/research). Runs in GitHub Actions
 * (.github/workflows/research.yml); writes research.md / research.json into --out.
 *
 *   npx tsx scripts/research.ts --out out/research --days 730
 *   npx tsx scripts/research.ts --only events --symbols BTC,ETH --days 180
 *   npx tsx scripts/research.ts --only portfolio          # daily strategies on the full history since 2019
 */

import fs from "fs";
import path from "path";
import { loadPooledDataset } from "@/services/pooled/dataset";
import { computePooledFeatureSeries } from "@/services/pooled/features";
import { POOLED_UNIVERSE } from "@/services/pooled/index";
import { studyEvents } from "@/services/research/events";
import { BIGMOVE_CONFIGS, studyBigMove } from "@/services/research/bigmove";
import { describeVerdict } from "@/services/research/common";
import { archiveFunding, archiveKlines } from "@/services/pooled/archive";
import { datasetPeriod } from "@/services/pooled/dataset";
import {
  basketStrategy,
  buildUniverse,
  describePortfolio,
  fundingStrategy,
  holdStrategy,
  lowVolStrategy,
  runStrategy,
  studyPortfolio,
  trendStrategy,
} from "@/services/research/portfolio";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const out = arg("out") ?? path.join(process.cwd(), "out", "research");
const cacheDir = arg("cache") ?? path.join(process.cwd(), "data", "archive");
const days = Number(arg("days") ?? 730);
const only = arg("only");
const symbols = arg("symbols")?.split(",").map((s) => s.toUpperCase().replace(/USDT$/, "") + "USDT") ?? POOLED_UNIVERSE;

/** Slow strategies on daily bars since the first futures listings (2019): trend, low volatility, funding carry. */
async function portfolioSection(log: (line: string) => void, report: string[], json: Record<string, unknown>) {
  const { to } = datasetPeriod(1);
  const from = Date.UTC(2019, 8, 1);
  const opts = { cacheDir, concurrency: 12, log };
  const series = [];
  for (const symbol of symbols) {
    try {
      const candles = await archiveKlines(symbol, "1d", from, to, opts);
      const funding = await archiveFunding(symbol, from, to, opts);
      if (candles.length < 120) continue;
      series.push({ symbol, candles, funding });
      log(`  ${symbol}: дней ${candles.length} с ${new Date(candles[0].openTime).toISOString().slice(0, 10)}, фандингов ${funding.length}`);
    } catch (e) {
      log(`  ${symbol}: ${(e as Error).message}`);
    }
  }
  const u = buildUniverse(series);
  // Same split for every strategy: 60/40 of the days from the moment the trend strategy can trade.
  const start = runStrategy(u, trendStrategy(false)).start;
  const split = start + Math.floor((u.days.length - start) * 0.6);
  const day = (i: number) => new Date(u.days[i]).toISOString().slice(0, 10);
  const studies = [
    studyPortfolio("Следование тренду (ансамбль пробоев Donchian 5–360 дней, цель волатильности 25%)", u, [
      { label: "только лонг", strategy: () => trendStrategy(false) },
      { label: "лонг и шорт", strategy: () => trendStrategy(true) },
    ], split),
    studyPortfolio("Низкая волатильность (лонг спокойной трети, шорт волатильной, раз в месяц)", u, [
      { label: "волатильность за 60 дней", strategy: () => lowVolStrategy(60) },
      { label: "волатильность за 90 дней", strategy: () => lowVolStrategy(90) },
    ], split),
    studyPortfolio("Фандинг в поперечнике (лонг низкого фандинга, шорт высокого, раз в неделю)", u, [
      { label: "средний фандинг за 3 дня", strategy: () => fundingStrategy(3) },
      { label: "средний фандинг за 7 дней", strategy: () => fundingStrategy(7) },
    ], split),
  ];
  const benchmarks = studyPortfolio("Ориентиры (не стратегии)", u, [
    { label: "держать BTC (перп, с фандингом)", strategy: () => holdStrategy("BTCUSDT") },
    { label: "равные доли всех монет, раз в месяц", strategy: () => basketStrategy() },
  ], split);

  report.push(
    `## Медленные стратегии на дневных свечах`,
    ``,
    `${u.symbols.length} монет, ${day(start)} → ${day(u.days.length - 1)}; подбор до ${day(split)}, проверка после. ` +
      `Сделки рыночными (0,05% + 0,03% за сторону на изменение позиции), фандинг по истории. Проходит при прибыли на проверке и t ≥ 2.`,
    "```"
  );
  for (const v of [...studies, benchmarks]) {
    const text = describePortfolio(v).replace(/^❌ Ориентиры.*$/m, "Ориентиры для сравнения (не стратегии):");
    log(text);
    report.push(text);
  }
  report.push("```", "");
  json.portfolio = { start: u.days[start], split: u.days[split], studies, benchmarks };
}

async function main() {
  const log = (line: string) => console.log(line);
  const report: string[] = [
    `# Исследование`,
    ``,
    `Исполнение: вход и стоп рыночными (0,05% + проскальзывание 0,03%), цель лимитным (0,02%); одна позиция на монету.`,
    `Вариант выбирается на первых 60% периода и проверяется один раз на последних 40%.`,
    ``,
  ];
  const json: Record<string, unknown> = {};

  if (only === "portfolio") {
    log("\n== Медленные стратегии");
    await portfolioSection(log, report, json);
    return finish(report, json, log);
  }

  const data = await loadPooledDataset(symbols, "1h", days, cacheDir, log);
  const series = data.series.map((s) => ({
    ...s,
    rows: computePooledFeatureSeries(s.candles, { btc: s.symbol === "BTCUSDT" ? s.candles : data.btc, derivs: data.derivs.get(s.symbol)! }).rows,
  }));
  report.push(
    `Часовые данные: ${series.length} монет, ${new Date(data.from).toISOString().slice(0, 10)} → ${new Date(data.to).toISOString().slice(0, 10)}. ` +
      `Для событий и крупных движений проходит, только если на проверке ≥30 сделок, плюс после комиссий и t ≥ 2.`,
    ``
  );
  Object.assign(json, { from: data.from, to: data.to, symbols: series.map((s) => s.symbol) });

  if (!only || only === "events") {
    log(`\n== Редкие события`);
    const events = studyEvents(series, data.from, data.to);
    json.events = events;
    report.push(`## Редкие события`, "```");
    for (const v of events) {
      const text = `${describeVerdict(v)}\n    событий: ${v.events}`;
      log(text);
      report.push(text);
    }
    report.push("```", "");
  }

  if (!only || only === "bigmove") {
    log(`\n== Крупные движения`);
    const results = [];
    report.push(`## Крупные движения (±θ первым за H часов)`, "```");
    for (const config of BIGMOVE_CONFIGS) {
      log(`  θ=${config.theta * 100}%, H=${config.horizon} ч`);
      const r = studyBigMove(series, config, data.from, data.to, 5, log);
      results.push(r);
      const text =
        `${describeVerdict(r)}\n` +
        `    примеров ${r.samples}; первым вверх ${(r.baseRates.up * 100).toFixed(1)}%, вниз ${(r.baseRates.down * 100).toFixed(1)}%; ` +
        `AUC вверх ${r.auc.up.toFixed(3)}, вниз ${r.auc.down.toFixed(3)}`;
      log(text);
      report.push(text);
    }
    json.bigmove = results;
    report.push("```", "");
  }

  if (!only) {
    log("\n== Медленные стратегии");
    await portfolioSection(log, report, json);
  }
  finish(report, json, log);
}

function finish(report: string[], json: Record<string, unknown>, log: (line: string) => void) {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "research.md"), report.join("\n"));
  fs.writeFileSync(path.join(out, "research.json"), JSON.stringify(json, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.join("\n") + "\n");
  log(`\nОтчёт: ${path.join(out, "research.md")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
