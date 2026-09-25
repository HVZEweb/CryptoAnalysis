/**
 * End-to-end training run: load history → train → validate → save, per timeframe.
 * Used by scripts/train-predictor.ts and the retrain API.
 */

import type { Candle, Timeframe } from "@/types";
import { ALL_TIMEFRAMES, HORIZONS } from "@/services/predictor/config";
import { fetchHistory, listCsvSeries, loadCsvCandles, resampleCandles } from "@/services/predictor/data";
import { saveModel } from "@/services/predictor";
import { trainPredictor, type PredictorModel } from "@/services/predictor/train";

export interface TrainingOptions {
  source?: "binance" | "csv";
  timeframes?: Timeframe[];
  symbols?: string[];
  days?: number;
  log?: (line: string) => void;
}

export const DEFAULT_TRAINING_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function describeModel(m: PredictorModel): string {
  const v = m.validation;
  return [
    `  выбрана модель: ${m.chosen}`,
    `  данные: ${m.symbols.join(", ")} · ${m.dataFrom.slice(0, 10)} → ${m.dataTo.slice(0, 10)} · ${m.samples} примеров`,
    `  точность направления: ${pct(v.accuracy)} (наивный прогноз: ${pct(v.baselineAccuracy)}, z=${v.zScore.toFixed(1)})`,
    `  уверенные сигналы (≥55%): ${pct(v.confident.share)} случаев, точность ${pct(v.confident.accuracy)}`,
    `  log-loss ${v.logLoss.toFixed(4)} vs ${v.baselineLogLoss.toFixed(4)} · AUC ${v.auc.toFixed(3)}`,
    `  попадание цены в коридор 10–90%: ${pct(v.band80Coverage)} (цель ≈ 80%)`,
    `  вывод: ${v.hasEdge ? "есть статистически значимое преимущество — направление используется" : "преимущества нет — используется только ценовой коридор"}`,
    ...describeStrategy(m),
  ].join("\n");
}

function describeStrategy(m: PredictorModel): string[] {
  const s = m.strategy;
  if (!s) return [];
  const lines = [`  сделки после комиссий: ${s.profitable ? "есть проверенная прибыльная настройка" : "выгодной сделки нет"} — ${s.reason}`];
  if (s.best) {
    const { setup, selection: a, holdout: b } = s.best;
    lines.push(
      `  лучшая из ${s.setupsTested}: стоп ${setup.slAtr} ATR, цель ×${setup.rr}, до ${setup.horizon} баров, сигнал от ${(setup.minEdge * 100).toFixed(0)} п.п.`,
      `    подбор:   ${a.trades} сделок, ${a.avgNetBp.toFixed(1)} п./сделку, в плюс ${pct(a.winRate)}`,
      `    проверка: ${b.trades} сделок, ${b.avgNetBp.toFixed(1)} п./сделку (рыночными ${b.avgNetBpTaker.toFixed(1)}), в плюс ${pct(b.winRate)}, t=${b.tStat.toFixed(1)}`
    );
  }
  return lines;
}

async function loadSeries(
  timeframe: Timeframe,
  options: Required<Omit<TrainingOptions, "timeframes">>
): Promise<Array<{ symbol: string; candles: Candle[] }>> {
  const spec = HORIZONS[timeframe];
  if (options.source === "csv") {
    return listCsvSeries()
      .filter((s) => spec.intervalMinutes % s.minutes === 0)
      .map((s) => ({
        symbol: s.symbol,
        candles: resampleCandles(loadCsvCandles(s.file, s.minutes), s.minutes, spec.intervalMinutes),
      }));
  }
  const out: Array<{ symbol: string; candles: Candle[] }> = [];
  for (const symbol of options.symbols) {
    try {
      out.push({ symbol, candles: await fetchHistory(symbol, spec.interval, options.days) });
    } catch (e) {
      options.log(`  ${symbol} ${spec.interval}: ${(e as Error).message ?? e}`);
    }
  }
  return out;
}

export async function trainAll(options: TrainingOptions = {}): Promise<PredictorModel[]> {
  const opts = {
    source: options.source ?? "binance",
    symbols: options.symbols ?? DEFAULT_TRAINING_SYMBOLS,
    days: options.days ?? 1095,
    log: options.log ?? (() => undefined),
  };
  const trained: PredictorModel[] = [];
  for (const timeframe of options.timeframes ?? ALL_TIMEFRAMES) {
    const spec = HORIZONS[timeframe];
    opts.log(`\n[${timeframe}] бары ${spec.interval}, горизонт ${spec.horizon}`);
    try {
      const series = (await loadSeries(timeframe, opts)).filter((s) => s.candles.length > 0);
      let btc = series.find((s) => s.symbol === "BTCUSDT")?.candles;
      if (!btc && opts.source === "binance") {
        btc = await fetchHistory("BTCUSDT", spec.interval, opts.days).catch(() => undefined);
      }
      if (!btc) opts.log("  нет свечей BTC — признаки BTC будут нулевыми");
      const model = trainPredictor(timeframe, series, opts.source, { btc, log: opts.log });
      const file = saveModel(model);
      opts.log(describeModel(model));
      opts.log(`  сохранено: ${file}`);
      trained.push(model);
    } catch (e) {
      opts.log(`  пропущено: ${(e as Error).message}`);
    }
  }
  return trained;
}
