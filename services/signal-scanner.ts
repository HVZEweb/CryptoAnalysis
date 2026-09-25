/**
 * Background signal scanner: every few minutes the server runs the trained models on fresh candles
 * and sends a Telegram message when a timeframe's validated strategy (see services/strategy-lab)
 * calls a trade. Only setups that made money after fees on unseen history are ever sent, and only on
 * the coins the model was validated on. One message per coin and timeframe until that trade's
 * holding time is over, like the one-position-per-coin rule of the lab.
 */

import fs from "fs";
import path from "path";
import type { Candle, Timeframe } from "@/types";
import { ALL_TIMEFRAMES, HORIZONS } from "@/services/predictor/config";
import { loadModel, predictWithModel, type PredictorModel } from "@/services/predictor";
import { strategySignal } from "@/services/strategy-lab/signal";
import { fetchCandles } from "@/services/binance";
import { getTelegramConfig, sendTelegram } from "@/lib/telegram";
import type { StrategySignal } from "@/types";

const STATE_FILE = path.join(process.cwd(), ".cache", "signal-scanner.json");

interface ScannerState {
  /** symbol:timeframe → until when a sent trade is still running (ms) */
  busyUntil: Record<string, number>;
  /** Timeframes whose strategy passed validation at the last scan */
  profitable: string[] | null;
  lastScanAt?: string;
  lastSignalAt?: string;
}

export interface ScanDeps {
  candles: (symbol: string, interval: string) => Promise<Candle[]>;
  send: (text: string) => Promise<boolean>;
  models: (timeframe: Timeframe) => PredictorModel | null;
  now: () => number;
  stateFile: string;
}

const defaultDeps: ScanDeps = {
  candles: (symbol, interval) => fetchCandles(symbol, interval, "Spot", 300),
  send: (text) => sendTelegram(text),
  models: (timeframe) => loadModel(timeframe),
  now: () => Date.now(),
  stateFile: STATE_FILE,
};

function readState(file: string): ScannerState {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as ScannerState;
  } catch {
    return { busyUntil: {}, profitable: null };
  }
}

function writeState(file: string, state: ScannerState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
}

export function scannerState(): ScannerState {
  return readState(STATE_FILE);
}

const fmt = (n: number) => (n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toPrecision(4));
const pct = (a: number, b: number) => `${(((a - b) / b) * 100).toFixed(2)}%`;

export function signalMessage(
  symbol: string,
  timeframe: Timeframe,
  signal: StrategySignal,
  price: number,
  pUp: number,
  closeBy: number
): string {
  const h = signal.holdout!;
  const setup = signal.setup!;
  const { tp, sl } = signal.levels!;
  const long = signal.side === "LONG";
  const losers = Math.round((1 - h.winRate) * 100);
  const order = h.avgNetBpTaker > 0 ? "рыночным или лимитным ордером" : "только лимитным ордером";
  return [
    `${long ? "🟢" : "🔴"} <b>${signal.side} ${symbol}</b> · ${timeframe}`,
    `Вход: ~${fmt(price)} (${order})`,
    `TP: ${fmt(tp)} (${long ? "+" : ""}${pct(tp, price)})`,
    `SL: ${fmt(sl)} (${pct(sl, price)})`,
    `Закрыть не позже: ${new Date(closeBy).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК (${setup.horizonBars} × ${setup.interval})`,
    `Модель: ${(pUp * 100).toFixed(1)}% за рост`,
    ``,
    `На истории, которую стратегия не видела при подборе: ${h.trades} сделок, в плюс ${(h.winRate * 100).toFixed(0)}%, ` +
      `в среднем ${h.avgNetBp >= 0 ? "+" : ""}${h.avgNetBp.toFixed(1)} п. (${(h.avgNetBp / 100).toFixed(2)}%) на сделку после комиссий.`,
    `⚠️ Не гарантия: примерно ${losers} из 100 таких сделок закрывались в минус. Прибыль — в среднем на серии сделок, рискуйте небольшой долей депозита.`,
  ].join("\n");
}

export interface ScanResult {
  skipped?: "no_telegram";
  profitableTimeframes: string[];
  checked: number;
  sent: number;
  errors: string[];
}

export async function scanSignals(deps: ScanDeps = defaultDeps, requireTelegram = true): Promise<ScanResult> {
  const result: ScanResult = { profitableTimeframes: [], checked: 0, sent: 0, errors: [] };
  if (requireTelegram && !getTelegramConfig()) return { ...result, skipped: "no_telegram" };

  const now = deps.now();
  const state = readState(deps.stateFile);
  const models = ALL_TIMEFRAMES.map((tf) => ({ tf, model: deps.models(tf) })).filter(
    (m): m is { tf: Timeframe; model: PredictorModel } => Boolean(m.model?.strategy?.profitable)
  );
  result.profitableTimeframes = models.map((m) => m.tf);

  // Tell when retraining turned a timeframe's strategy on or off, so silence is never ambiguous.
  if (state.profitable) {
    const added = result.profitableTimeframes.filter((tf) => !state.profitable!.includes(tf));
    const removed = state.profitable.filter((tf) => !result.profitableTimeframes.includes(tf));
    if (added.length) {
      await deps.send(`✅ Стратегия прошла проверку на новых данных: ${added.join(", ")}. Буду присылать сигналы по этим таймфреймам.`);
    }
    if (removed.length) {
      await deps.send(`⏸ После переобучения стратегия больше не проходит проверку: ${removed.join(", ")}. Сигналы по ним остановлены.`);
    }
  }
  state.profitable = result.profitableTimeframes;

  const candleCache = new Map<string, Promise<Candle[]>>();
  const closed = (symbol: string, interval: string) => {
    const key = `${symbol}:${interval}`;
    if (!candleCache.has(key)) {
      candleCache.set(
        key,
        deps.candles(symbol, interval).then((c) => c.filter((x) => x.closeTime < now))
      );
    }
    return candleCache.get(key)!;
  };

  for (const { tf, model } of models) {
    const intervalMs = HORIZONS[tf].intervalMinutes * 60_000;
    for (const symbol of model.symbols) {
      const key = `${symbol}:${tf}`;
      if ((state.busyUntil[key] ?? 0) > now) continue;
      try {
        const candles = await closed(symbol, model.interval);
        const last = candles.at(-1);
        if (!last) continue;
        const btc = symbol === "BTCUSDT" ? candles : await closed("BTCUSDT", model.interval).catch(() => undefined);
        const run = predictWithModel(model, candles, last.close, { btc });
        result.checked++;
        if (!run) continue;
        const signal = strategySignal(run, last.close);
        if (signal.status !== "trade") continue;

        const closeBy = last.closeTime + 1 + signal.setup!.horizonBars * intervalMs;
        await deps.send(signalMessage(symbol, tf, signal, last.close, run.probabilityUp, closeBy));
        state.busyUntil[key] = closeBy;
        state.lastSignalAt = new Date(now).toISOString();
        result.sent++;
      } catch (e) {
        result.errors.push(`${key}: ${(e as Error).message}`);
      }
    }
  }

  for (const [k, until] of Object.entries(state.busyUntil)) if (until <= now) delete state.busyUntil[k];
  state.lastScanAt = new Date(now).toISOString();
  writeState(deps.stateFile, state);
  return result;
}
