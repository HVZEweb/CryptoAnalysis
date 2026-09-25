/**
 * Research run on the Binance archive: rare positioning events and "big move" models, both judged
 * after realistic costs on a holdout period (services/research). Runs in GitHub Actions
 * (.github/workflows/research.yml); writes research.md / research.json into --out.
 *
 *   npx tsx scripts/research.ts --out out/research --days 730
 *   npx tsx scripts/research.ts --only events --symbols BTC,ETH --days 180
 *   npx tsx scripts/research.ts --only portfolio          # daily strategies on the full history since 2019
 *   npx tsx scripts/research.ts --only funding            # robustness of the cross-sectional funding strategy
 *   npx tsx scripts/research.ts --only news               # how each type of news moved BTC (GDELT, ~3 months)
 */

import fs from "fs";
import path from "path";
import { loadPooledDataset } from "@/services/pooled/dataset";
import { computePooledFeatureSeries } from "@/services/pooled/features";
import { POOLED_UNIVERSE } from "@/services/pooled/index";
import { studyEvents } from "@/services/research/events";
import { BIGMOVE_CONFIGS, studyBigMove } from "@/services/research/bigmove";
import { describeVerdict } from "@/services/research/common";
import { archiveFunding, archiveKlines, listArchiveUsdtPerps } from "@/services/pooled/archive";
import { fetchGdeltHeadlines, gdeltDeps } from "@/services/news-study/gdelt";
import { baselineOf, describeTopics, movesAfter, newsTopic, studyTopics, type NewsEvent } from "@/services/news-study/study";
import { datasetPeriod } from "@/services/pooled/dataset";
import {
  basketStrategy,
  buildUniverse,
  describePortfolio,
  fundingStrategy,
  holdStrategy,
  liquidTop,
  lowVolStrategy,
  periodStats,
  REBALANCE_COST,
  yearlyStats,
  type PeriodStats,
  type Strategy,
  runStrategy,
  studyPortfolio,
  trendStrategy,
} from "@/services/research/portfolio";

/**
 * News event study: crypto headlines from GDELT (its API only covers about the last three months), classified
 * by the live news monitor's rules, and BTC's move after each from the 5-minute futures archive.
 */
async function newsSection(log: (line: string) => void, report: string[], json: Record<string, unknown>) {
  const DAY_MS = 86_400_000;
  const to = Date.now() - 2 * DAY_MS;
  const from = to - Math.min(days, 85) * DAY_MS;
  log(`  заголовки GDELT ${new Date(from).toISOString().slice(0, 10)} → ${new Date(to).toISOString().slice(0, 10)} (1 запрос в 5 с)`);
  let gdeltError = "";
  const articles = await fetchGdeltHeadlines(from, to, { ...gdeltDeps, log }).catch((e) => {
    gdeltError = (e as Error).message;
    log(`  GDELT недоступен: ${gdeltError}`);
    return [];
  });
  const btc = await archiveKlines("BTCUSDT", "5m", from - DAY_MS, to + DAY_MS + 60 * 60_000, { cacheDir, concurrency: 12, log });
  const events: NewsEvent[] = [];
  let untyped = 0;
  for (const a of articles) {
    const topic = newsTopic(a.title);
    if (!topic) {
      untyped++;
      continue;
    }
    events.push({ topic, time: a.seen, moves: movesAfter(btc, a.seen) });
  }
  const stats = studyTopics(events, baselineOf(btc));
  const lines = [
    ...(gdeltError ? [`⚠️ Загрузка заголовков прервана: ${gdeltError}. Результаты ниже — только по тому, что успело загрузиться.`] : []),
    `Заголовков после склейки перепечаток: ${articles.length}; с распознанным типом: ${events.length}, без типа или пересказ движения цены: ${untyped}.`,
    ...describeTopics(stats),
  ];
  for (const l of lines) log(l);
  report.push(
    `## Новости и цена BTC`,
    ``,
    `Заголовки из GDELT за ${new Date(from).toISOString().slice(0, 10)} → ${new Date(to).toISOString().slice(0, 10)}, время — когда GDELT впервые увидел статью. ` +
      `Ход BTC — от открытия первой 5-минутной свечи после этого момента, в сравнении со средним ходом за тот же срок в любой час. ` +
      `Одна история в пределах 6 часов считается один раз. Направление подтверждено только при 20+ событиях, |t| ≥ 2 и одном знаке в обеих половинах периода.`,
    "```",
    ...lines,
    "```",
    ""
  );
  json.news = { from, to, articles: articles.length, events: events.length, stats };
}

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

/**
 * Robustness of the cross-sectional funding strategy (it passed on today's 30 liquid coins):
 * a point-in-time universe of every USDT perpetual ever listed, legs apart, harsher slippage, by year.
 * Declared in advance: the verdict is on the top-50-by-volume universe with a 7-day window.
 */
async function fundingRobustness(log: (line: string) => void, report: string[], json: Record<string, unknown>) {
  const { to } = datasetPeriod(1);
  const from = Date.UTC(2019, 8, 1);
  const opts = { cacheDir, concurrency: 16, log };
  const all = arg("symbols") ? symbols : await listArchiveUsdtPerps();
  log(`  монет в архиве: ${all.length}`);
  const series = [];
  let done = 0;
  for (const symbol of all) {
    try {
      const candles = await archiveKlines(symbol, "1d", from, to, opts);
      if (candles.length >= 60) series.push({ symbol, candles, funding: await archiveFunding(symbol, from, to, opts) });
    } catch (e) {
      log(`  ${symbol}: ${(e as Error).message}`);
    }
    if (++done % 50 === 0) log(`  загружено ${done}/${all.length}`);
  }
  const u = buildUniverse(series);
  const split = u.days.findIndex((t) => t >= Date.UTC(2024, 0, 13));
  const day = (i: number) => new Date(u.days[i]).toISOString().slice(0, 10);
  const today30 = new Set(POOLED_UNIVERSE);

  const variants: Array<{ label: string; strategy: Strategy; cost?: number; main?: boolean }> = [
    { label: "сегодняшние 30 монет (как в прошлой проверке)", strategy: fundingStrategy(7, { eligible: (x, s) => today30.has(x.symbols[s]) }) },
    { label: "топ-30 по обороту на каждую дату", strategy: fundingStrategy(7, { eligible: liquidTop(30) }) },
    { label: "топ-50 по обороту на каждую дату — ГЛАВНЫЙ", strategy: fundingStrategy(7, { eligible: liquidTop(50) }), main: true },
    { label: "топ-100 по обороту на каждую дату", strategy: fundingStrategy(7, { eligible: liquidTop(100) }) },
    { label: "топ-50, только лонговая нога", strategy: fundingStrategy(7, { eligible: liquidTop(50), leg: "long" }) },
    { label: "топ-50, только шортовая нога", strategy: fundingStrategy(7, { eligible: liquidTop(50), leg: "short" }) },
    { label: "топ-50, проскальзывание 0,1% вместо 0,03%", strategy: fundingStrategy(7, { eligible: liquidTop(50) }), cost: 0.0015 },
    { label: "ориентир: держать BTC", strategy: holdStrategy("BTCUSDT") },
  ];
  const f = (s: PeriodStats) =>
    `${s.annualReturnPct >= 0 ? "+" : ""}${s.annualReturnPct.toFixed(1)}%/год, Sharpe ${s.sharpe.toFixed(2)}, t=${s.tStat.toFixed(1)}, просадка ${s.maxDrawdownPct.toFixed(0)}%`;

  report.push(
    `## Устойчивость стратегии «фандинг в поперечнике» (окно 7 дней, пересборка по понедельникам)`,
    ``,
    `${u.symbols.length} USDT-фьючерсов за всю историю, включая снятые с торгов; ${day(0)} → ${day(u.days.length - 1)}. ` +
      `Подбор до ${day(split)}, проверка после (как в прошлом прогоне). Стоимость ${(REBALANCE_COST * 100).toFixed(2)}% за сторону, если не сказано иное.`,
    "```"
  );
  const rows = [];
  let mainPassed = false;
  for (const v of variants) {
    const run = runStrategy(u, v.strategy, v.cost);
    const sel = periodStats(run.returns.slice(run.start, split));
    const hold = periodStats(run.returns.slice(split));
    const full = periodStats(run.returns.slice(run.start));
    if (v.main) mainPassed = sel.annualReturnPct > 0 && hold.annualReturnPct > 0 && hold.tStat >= 2;
    const years = yearlyStats(u, run.returns, run.start);
    const perYear = (x: number) => ((x / ((u.days.length - run.start) / 365)) * 100).toFixed(1);
    const text = [
      `${v.main ? "▶" : " "} ${v.label} (с ${day(run.start)})`,
      `    подбор:   ${f(sel)}`,
      `    проверка: ${f(hold)}`,
      `    всё время: ${f(full)}`,
      `    по годам: ${years.map((y) => `${y.year} ${y.stats.totalPct >= 0 ? "+" : ""}${y.stats.totalPct.toFixed(0)}%`).join(" · ")}`,
      `    фандинг ${perYear(run.funding)}%/год, комиссии и проскальзывание ${perYear(run.costs)}%/год`,
    ].join("\n");
    log(text);
    report.push(text);
    rows.push({ label: v.label, main: Boolean(v.main), selection: sel, holdout: hold, full, years, funding: run.funding, costs: run.costs });
  }
  const verdict = mainPassed
    ? "✅ Главный вариант (топ-50 на каждую дату) прибылен на обоих периодах и проходит проверку (t ≥ 2)."
    : "❌ Главный вариант (топ-50 на каждую дату) не проходит: прибыль на обоих периодах и t ≥ 2 не подтвердились без ошибки выжившего.";
  report.push("```", "", verdict, "");
  log(verdict);
  json.funding = { symbols: u.symbols.length, split: u.days[split], rows, mainPassed };
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

  if (only === "news") {
    log("\n== Новости и цена BTC");
    await newsSection(log, report, json);
    return finish(report, json, log);
  }

  if (only === "funding") {
    log("\n== Устойчивость фандинг-стратегии");
    await fundingRobustness(log, report, json);
    return finish(report, json, log);
  }

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
