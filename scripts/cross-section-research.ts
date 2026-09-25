/**
 * Cross-sectional research on Binance futures: rank coins against each other, long the best fifth,
 * short the worst, fees included. Needs Binance access, so run it on the server.
 *
 *   npm run research:cross-section
 *   npm run research:cross-section -- --count 30 --days 730
 */

import { installOutboundProxy } from "@/lib/outbound-proxy";
import { runCrossSection } from "@/services/cross-section/run";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const bp = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)} п.`;

installOutboundProxy()
  .then(() =>
    runCrossSection({
      count: arg("count") ? Number(arg("count")) : undefined,
      days: arg("days") ? Number(arg("days")) : undefined,
      log: console.log,
    })
  )
  .then(({ report, file }) => {
    console.log(`\n${report.dataFrom.slice(0, 10)} → ${report.dataTo.slice(0, 10)}, проверено настроек: ${report.setupsTested}`);
    for (const l of report.leaders) {
      const s = l.setup;
      console.log(
        `  ${s.mode.padEnd(8)} ${String(s.lookback).padStart(2)} д. / ${String(s.hold).padStart(2)} д.: ` +
          `подбор ${bp(l.selection.avgNetBp)} (Sharpe ${l.selection.sharpe.toFixed(2)}) → проверка ${bp(l.holdout.avgNetBp)} ` +
          `(${l.holdout.annualPct.toFixed(1)}% годовых, t=${l.holdout.tStat.toFixed(1)})`
      );
    }
    console.log(`\nВывод: ${report.profitable ? "ЕСТЬ преимущество" : "преимущества нет"} — ${report.reason}`);
    console.log(`Отчёт: ${file}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error("Исследование не удалось:", (e as Error).message ?? e);
    process.exit(1);
  });
