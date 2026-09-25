/**
 * Background signal scanner, run every few minutes inside the site's process.
 *
 * For each coin on the Telegram chat's watchlist it runs every model that may signal on that coin —
 * the per-timeframe candle models and the pooled model — and sends a trade only when the model's
 * setup made money after fees on unseen history, overall and on that coin (services/signals/logic).
 * Every signal is logged; when it ends (TP, SL or holding time) the real result is sent, and a model
 * whose live results lose money after fees is switched off until it is retrained.
 */

import fs from "fs";
import path from "path";
import type { Candle, MarketType, StrategySignal, Timeframe } from "@/types";
import { ALL_TIMEFRAMES, HORIZONS } from "@/services/predictor/config";
import { loadModel, predictWithModel, type PricePrediction, type PredictorModel } from "@/services/predictor";
import { loadDerivsFromDb, loadPooledModel, POOLED_TIMEFRAMES, predictPooled } from "@/services/pooled/index";
import type { DerivData } from "@/services/pooled/derivs";
import { strategySignal } from "@/services/strategy-lab/signal";
import { fetchCandles } from "@/services/binance";
import { getTelegramConfig, sendTelegram } from "@/lib/telegram";
import * as realStore from "@/services/signals/store";
import { coinVerdict, disableReason, evaluateOutcome, type Outcome } from "@/services/signals/logic";

const STATE_FILE = path.join(process.cwd(), ".cache", "signal-scanner.json");

interface ScannerState {
  /** Model keys whose strategy passed validation at the last scan */
  profitable: string[] | null;
  /** symbol:model → bar time of the last observation message (observe mode) */
  observed?: Record<string, number>;
  lastScanAt?: string;
  lastSignalAt?: string;
}

export interface ModelEntry {
  /** "candles:4h" or "pooled:1h" */
  key: string;
  kind: "candles" | "pooled";
  timeframe: Timeframe;
  model: PredictorModel;
}

export type SignalStore = Pick<
  typeof realStore,
  "getChat" | "getWatchlist" | "logSignal" | "openSignals" | "closeSignal" | "closedSignals" | "disabledModels" | "disableModel"
>;

export interface ScanDeps {
  chatId: () => string | null;
  send: (text: string) => Promise<boolean>;
  candles: (symbol: string, interval: string, market: MarketType) => Promise<Candle[]>;
  derivs: (symbol: string, since: number) => Promise<DerivData>;
  models: () => ModelEntry[];
  store: SignalStore;
  now: () => number;
  stateFile: string;
}

export function loadModelEntries(): ModelEntry[] {
  const entries: ModelEntry[] = [];
  for (const tf of ALL_TIMEFRAMES) {
    const model = loadModel(tf);
    if (model) entries.push({ key: `candles:${tf}`, kind: "candles", timeframe: tf, model });
  }
  for (const tf of POOLED_TIMEFRAMES) {
    const model = loadPooledModel(tf);
    if (model) entries.push({ key: `pooled:${tf}`, kind: "pooled", timeframe: tf, model });
  }
  return entries;
}

const defaultDeps: ScanDeps = {
  chatId: () => getTelegramConfig()?.chatId ?? null,
  send: (text) => sendTelegram(text),
  candles: (symbol, interval, market) => fetchCandles(symbol, interval, market, 500),
  derivs: (symbol, since) => loadDerivsFromDb(symbol, since),
  models: loadModelEntries,
  store: realStore,
  now: () => Date.now(),
  stateFile: STATE_FILE,
};

function readState(file: string): ScannerState {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as ScannerState;
  } catch {
    return { profitable: null };
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
const msk = (t: number) => new Date(t).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
const modelTitle = (e: Pick<ModelEntry, "kind" | "timeframe">) => `${e.timeframe}${e.kind === "pooled" ? " · общая модель" : ""}`;

export function signalMessage(
  symbol: string,
  title: string,
  signal: StrategySignal,
  price: number,
  pUp: number,
  closeBy: number,
  coinLine?: string
): string {
  const h = signal.holdout!;
  const setup = signal.setup!;
  const { tp, sl } = signal.levels!;
  const long = signal.side === "LONG";
  const losers = Math.round((1 - h.winRate) * 100);
  const order = h.avgNetBpTaker > 0 ? "рыночным или лимитным ордером" : "только лимитным ордером";
  return [
    `${long ? "🟢" : "🔴"} <b>${signal.side} ${symbol}</b> · ${title}`,
    `Вход: ~${fmt(price)} (${order})`,
    `TP: ${fmt(tp)} (${long ? "+" : ""}${pct(tp, price)})`,
    `SL: ${fmt(sl)} (${pct(sl, price)})`,
    `Закрыть не позже: ${msk(closeBy)} МСК (${setup.horizonBars} × ${setup.interval})`,
    `Модель: ${(pUp * 100).toFixed(1)}% за рост`,
    ``,
    `На истории, которую стратегия не видела при подборе: ${h.trades} сделок, в плюс ${(h.winRate * 100).toFixed(0)}%, ` +
      `в среднем ${h.avgNetBp >= 0 ? "+" : ""}${h.avgNetBp.toFixed(1)} п. (${(h.avgNetBp / 100).toFixed(2)}%) на сделку после комиссий.`,
    ...(coinLine ? [`По ${symbol}: ${coinLine}.`] : []),
    `⚠️ Не гарантия: примерно ${losers} из 100 таких сделок закрывались в минус. Прибыль — в среднем на серии сделок, рискуйте небольшой долей депозита.`,
  ].join("\n");
}

export function outcomeMessage(s: realStore.SignalRow, o: Outcome): string {
  const icon = o.status === "tp" ? "✅" : o.status === "sl" ? "❌" : "⏱";
  const what = o.status === "tp" ? "цель достигнута" : o.status === "sl" ? "сработал стоп" : "закрыт по времени";
  const sign = o.netBp >= 0 ? "+" : "";
  return (
    `${icon} <b>${s.side} ${s.symbol}</b> · ${s.timeframe}: ${what}\n` +
    `Вход ${fmt(s.entry)} → выход ${fmt(o.exitPrice)}: ${sign}${o.netBp.toFixed(1)} п. (${sign}${(o.netBp / 100).toFixed(2)}%) после комиссий лимитными ордерами.`
  );
}

export interface ScanResult {
  skipped?: "no_telegram";
  profitableModels: string[];
  checked: number;
  sent: number;
  closed: number;
  errors: string[];
}

async function closeFinished(deps: ScanDeps, entries: ModelEntry[], result: ScanResult): Promise<void> {
  const open = await deps.store.openSignals();
  for (const s of open) {
    try {
      // Judged on the same market the signal was computed on.
      const market: MarketType = s.model_key.startsWith("pooled:") ? "Futures" : "Spot";
      const candles = (await deps.candles(s.symbol, s.bar_interval, market)).filter((c) => c.closeTime < deps.now());
      const outcome = evaluateOutcome(s, candles);
      if (!outcome) continue;
      await deps.store.closeSignal(s.id, { status: outcome.status, exitPrice: outcome.exitPrice, grossBp: outcome.grossBp, netBp: outcome.netBp, closedAt: outcome.exitTime });
      await deps.send(outcomeMessage(s, outcome));
      result.closed++;

      // Live results of this model version: switch it off if they lose money after fees.
      const rows = await deps.store.closedSignals({ modelKey: s.model_key, trainedAt: s.model_trained_at });
      const reason = disableReason(rows);
      const current = entries.find((e) => e.key === s.model_key);
      if (reason && current?.model.trainedAt === s.model_trained_at) {
        const disabled = await deps.store.disabledModels();
        if (disabled.get(s.model_key)?.trainedAt !== s.model_trained_at) {
          await deps.store.disableModel(s.model_key, s.model_trained_at, reason);
          await deps.send(`⏸ Сигналы ${modelTitle(current)} остановлены: ${reason}. Включатся снова после переобучения модели.`);
        }
      }
    } catch (e) {
      result.errors.push(`close ${s.symbol}: ${(e as Error).message}`);
    }
  }
}

export async function scanSignals(deps: ScanDeps = defaultDeps): Promise<ScanResult> {
  const result: ScanResult = { profitableModels: [], checked: 0, sent: 0, closed: 0, errors: [] };
  const chatId = deps.chatId();
  if (!chatId) return { ...result, skipped: "no_telegram" };

  const now = deps.now();
  const state = readState(deps.stateFile);
  const entries = deps.models();
  await closeFinished(deps, entries, result);

  const disabled = await deps.store.disabledModels();
  const active = entries.filter((e) => e.model.strategy?.profitable && disabled.get(e.key)?.trainedAt !== e.model.trainedAt);
  result.profitableModels = active.map((e) => e.key);

  // Tell when retraining turned a model's strategy on or off, so silence is never ambiguous.
  if (state.profitable) {
    const titleOf = (key: string) => {
      const e = entries.find((x) => x.key === key);
      return e ? modelTitle(e) : key;
    };
    const added = result.profitableModels.filter((k) => !state.profitable!.includes(k));
    const removed = state.profitable.filter((k) => !result.profitableModels.includes(k));
    if (added.length) await deps.send(`✅ Стратегия прошла проверку на новых данных: ${added.map(titleOf).join(", ")}. /list покажет, по каким вашим монетам будут сигналы.`);
    if (removed.length) await deps.send(`⏸ Стратегия больше не проходит проверку: ${removed.map(titleOf).join(", ")}. Сигналы по ней остановлены.`);
  }
  state.profitable = result.profitableModels;

  const settings = await deps.store.getChat(chatId);
  const watch = await deps.store.getWatchlist(chatId);
  const openKeys = new Set((await deps.store.openSignals()).map((s) => `${s.symbol}:${s.model_key}`));
  state.observed ??= {};

  const candleCache = new Map<string, Promise<Candle[]>>();
  const closed = (symbol: string, interval: string, market: MarketType) => {
    const key = `${symbol}:${interval}:${market}`;
    if (!candleCache.has(key)) candleCache.set(key, deps.candles(symbol, interval, market).then((c) => c.filter((x) => x.closeTime < now)));
    return candleCache.get(key)!;
  };

  if (!settings.paused) {
    for (const entry of entries) {
      const { model } = entry;
      const isActive = active.includes(entry);
      if (!isActive && !(settings.observe && model.validation.hasEdge)) continue;
      const market: MarketType = entry.kind === "pooled" ? "Futures" : "Spot";
      for (const symbol of watch) {
        const key = `${symbol}:${entry.key}`;
        if (openKeys.has(key)) continue;
        const verdict = coinVerdict(model, symbol);
        if (isActive && !verdict.ok && !settings.observe) continue;
        if (!model.symbols.includes(symbol)) continue;
        try {
          const candles = await closed(symbol, model.interval, market);
          const last = candles.at(-1);
          if (!last) continue;
          const btc = symbol === "BTCUSDT" ? candles : await closed("BTCUSDT", model.interval, market).catch(() => undefined);
          let run: PricePrediction | null;
          if (entry.kind === "pooled") {
            run = predictPooled(model, candles, last.close, btc, await deps.derivs(symbol, candles[0].openTime));
          } else {
            run = predictWithModel(model, candles, last.close, { btc });
          }
          result.checked++;
          if (!run) continue;

          const signal = strategySignal(run, last.close);
          if (isActive && verdict.ok && signal.status === "trade") {
            const entryTime = last.closeTime + 1;
            const closeBy = entryTime + signal.setup!.horizonBars * HORIZONS[entry.timeframe].intervalMinutes * 60_000;
            await deps.send(signalMessage(symbol, modelTitle(entry), signal, last.close, run.probabilityUp, closeBy, verdict.text));
            await deps.store.logSignal({
              chat_id: chatId,
              model_key: entry.key,
              model_trained_at: model.trainedAt,
              symbol,
              timeframe: entry.timeframe,
              bar_interval: model.interval,
              side: signal.side!,
              entry: last.close,
              tp: signal.levels!.tp,
              sl: signal.levels!.sl,
              entry_time: entryTime,
              close_by: closeBy,
              sent_at: now,
            });
            openKeys.add(key);
            state.lastSignalAt = new Date(now).toISOString();
            result.sent++;
            continue;
          }

          // Observe mode: a strong view of a model with a validated direction edge, clearly not a trade.
          const edge = run.probabilityUp - 0.5;
          if (settings.observe && model.validation.hasEdge && Math.abs(edge) >= OBSERVE_EDGE && state.observed[key] !== last.openTime) {
            state.observed[key] = last.openTime;
            await deps.send(
              `👀 <b>Наблюдение, не торговый сигнал</b> · ${symbol} ${modelTitle(entry)}\n` +
                `Модель: ${(run.probabilityUp * 100).toFixed(1)}% за рост (${edge > 0 ? "вверх" : "вниз"}). ` +
                `Прибыль после комиссий для этого не подтверждена: ${verdict.ok ? "сигнал слабее проверенного порога" : verdict.text}.`
            );
          }
        } catch (e) {
          result.errors.push(`${key}: ${(e as Error).message}`);
        }
      }
    }
  }

  for (const [k, t] of Object.entries(state.observed ?? {})) if (now - t > 7 * 86_400_000) delete state.observed![k];
  state.lastScanAt = new Date(now).toISOString();
  writeState(deps.stateFile, state);
  return result;
}

/** |P(up) − 0.5| from which observe mode reports a model's view. */
export const OBSERVE_EDGE = 0.06;
