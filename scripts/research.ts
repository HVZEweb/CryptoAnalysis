/**
 * Research run on the Binance archive: rare positioning events and "big move" models, both judged
 * after realistic costs on a holdout period (services/research). Runs in GitHub Actions
 * (.github/workflows/research.yml); writes research.md / research.json into --out.
 *
 *   npx tsx scripts/research.ts --out out/research --days 730
 *   npx tsx scripts/research.ts --only events --symbols BTC,ETH --days 180
 */

import fs from "fs";
import path from "path";
import { loadPooledDataset } from "@/services/pooled/dataset";
import { computePooledFeatureSeries } from "@/services/pooled/features";
import { POOLED_UNIVERSE } from "@/services/pooled/index";
import { studyEvents } from "@/services/research/events";
import { BIGMOVE_CONFIGS, studyBigMove } from "@/services/research/bigmove";
import { describeVerdict } from "@/services/research/common";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const out = arg("out") ?? path.join(process.cwd(), "out", "research");
const cacheDir = arg("cache") ?? path.join(process.cwd(), "data", "archive");
const days = Number(arg("days") ?? 730);
const only = arg("only");
const symbols = arg("symbols")?.split(",").map((s) => s.toUpperCase().replace(/USDT$/, "") + "USDT") ?? POOLED_UNIVERSE;

async function main() {
  const log = (line: string) => console.log(line);
  const data = await loadPooledDataset(symbols, "1h", days, cacheDir, log);
  const series = data.series.map((s) => ({
    ...s,
    rows: computePooledFeatureSeries(s.candles, { btc: s.symbol === "BTCUSDT" ? s.candles : data.btc, derivs: data.derivs.get(s.symbol)! }).rows,
  }));
  const report: string[] = [
    `# Исследование: редкие события и крупные движения`,
    ``,
    `Данные: ${series.length} монет, ${new Date(data.from).toISOString().slice(0, 10)} → ${new Date(data.to).toISOString().slice(0, 10)}, часовые свечи Binance Futures.`,
    `Исполнение: вход и стоп рыночными (0,05% + проскальзывание 0,03%), цель лимитным (0,02%); одна позиция на монету.`,
    `Вариант выбирается на первых 60% периода и проверяется один раз на последних 40%. Проходит, только если на проверке ≥30 сделок, плюс после комиссий и t ≥ 2.`,
    ``,
  ];
  const json: Record<string, unknown> = { from: data.from, to: data.to, symbols: series.map((s) => s.symbol) };

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
