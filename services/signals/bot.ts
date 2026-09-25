/**
 * Telegram bot commands: the watchlist and settings are managed from the chat itself.
 * Long polling (getUpdates) from inside the site's process — no webhook, so no public URL is needed.
 * Only the chat connected in /admin is answered; anyone else writing to the bot is ignored.
 */

import fs from "fs";
import path from "path";
import axios from "axios";
import { binanceFuturesClient } from "@/lib/axios";
import { getTelegramConfig, sendTelegram, type TelegramConfig } from "@/lib/telegram";
import * as store from "@/services/signals/store";
import { coinVerdict, formatTrackRecord, normalizeSymbol, parseCommand, trackRecord } from "@/services/signals/logic";
import { loadModelEntries, scannerState, type ModelEntry } from "@/services/signal-scanner";
import { POOLED_UNIVERSE } from "@/services/pooled/index";

const OFFSET_FILE = path.join(process.cwd(), ".cache", "telegram-offset.json");
const MAX_WATCH = 30;

export const HELP = [
  "<b>Команды</b>",
  "/watch SOL DOGE — следить за монетами",
  "/unwatch SOL — убрать монету",
  "/list — ваши монеты и по каким моделям возможны сигналы",
  "/stats — реальные результаты отправленных сигналов",
  "/pause, /resume — остановить или возобновить сигналы",
  "/observe on|off — наблюдения: сильный взгляд модели без подтверждённой прибыли (не торговый сигнал)",
  "/news on|off — алерты по сильным новостям (включены по умолчанию)",
  "/listings on|off — новые монеты на OKX: анонсы, сводка и статистика прошлых листингов (включены по умолчанию)",
  "",
  "Сигнал приходит, только если настройка сделок заработала после комиссий на истории, которую не видела при подборе, — в целом и на этой монете. Поэтому бот может подолгу молчать: это значит, что проверенной выгодной сделки нет.",
].join("\n");

export interface BotDeps {
  store: Pick<typeof store, "addWatch" | "removeWatch" | "getWatchlist" | "getChat" | "setChat" | "closedSignals" | "openSignals">;
  models: () => ModelEntry[];
  symbolExists: (symbol: string) => Promise<boolean>;
}

const knownSymbols = new Map<string, boolean>();

async function futuresSymbolExists(symbol: string): Promise<boolean> {
  if (knownSymbols.has(symbol)) return knownSymbols.get(symbol)!;
  const ok = await binanceFuturesClient
    .get("/ticker/price", { params: { symbol }, timeout: 8_000 })
    .then(() => true)
    .catch((e) => (e?.response?.status === 400 ? false : Promise.reject(e)));
  knownSymbols.set(symbol, ok);
  return ok;
}

const defaultDeps: BotDeps = { store, models: loadModelEntries, symbolExists: futuresSymbolExists };

function coinLines(symbol: string, models: ModelEntry[]): string {
  const relevant = models.filter((m) => m.model.symbols.includes(symbol));
  if (!relevant.length) {
    return POOLED_UNIVERSE.includes(symbol)
      ? "  общая модель ещё не обучена — сигналов пока нет"
      : "  ни одна модель не обучалась на этой монете — сигналов не будет";
  }
  return relevant
    .map((m) => {
      const v = coinVerdict(m.model, symbol);
      return `  ${v.ok ? "✅" : "▫️"} ${m.timeframe}${m.kind === "pooled" ? " (общая)" : ""}: ${v.text}`;
    })
    .join("\n");
}

/** Reply to one message from the owner's chat. */
export async function handleCommand(chatId: string, text: string, deps: BotDeps = defaultDeps): Promise<string> {
  const c = parseCommand(text);
  if (!c) return "Не понял. " + HELP;
  const symbolsOf = (args: string[]) => {
    const good: string[] = [];
    const bad: string[] = [];
    for (const a of args) {
      const s = normalizeSymbol(a);
      if (s) good.push(s);
      else bad.push(a);
    }
    return { good: [...new Set(good)], bad };
  };

  switch (c.cmd) {
    case "start":
    case "help":
      return HELP;

    case "watch": {
      const { good, bad } = symbolsOf(c.args);
      if (!good.length) return "Укажите монеты: /watch SOL DOGE";
      const current = await deps.store.getWatchlist(chatId);
      const unknown: string[] = [];
      const added: string[] = [];
      for (const s of good) {
        if (current.includes(s)) continue;
        if (current.length + added.length >= MAX_WATCH) break;
        if (await deps.symbolExists(s)) added.push(s);
        else unknown.push(s);
      }
      if (added.length) await deps.store.addWatch(chatId, added);
      const models = deps.models();
      const lines = added.map((s) => `<b>${s}</b>\n${coinLines(s, models)}`);
      if (unknown.length || bad.length) lines.push(`Нет на фьючерсах Binance: ${[...unknown, ...bad].join(", ")}`);
      if (current.length + added.length >= MAX_WATCH) lines.push(`Максимум ${MAX_WATCH} монет.`);
      return lines.length ? `Добавлено:\n${lines.join("\n")}` : "Эти монеты уже в списке.";
    }

    case "unwatch": {
      const { good } = symbolsOf(c.args);
      if (!good.length) return "Укажите монеты: /unwatch SOL";
      const n = await deps.store.removeWatch(chatId, good);
      return n ? `Убрано: ${n}. Открытые сигналы по ним досчитаются до конца.` : "Этих монет не было в списке.";
    }

    case "list": {
      const watch = await deps.store.getWatchlist(chatId);
      const settings = await deps.store.getChat(chatId);
      if (!watch.length) return "Список пуст. Добавьте монеты: /watch BTC ETH SOL\n\n" + HELP;
      const models = deps.models();
      const head = settings.paused ? "⏸ Сигналы на паузе (/resume).\n" : "";
      return head + watch.map((s) => `<b>${s}</b>\n${coinLines(s, models)}`).join("\n");
    }

    case "stats": {
      const rows = await deps.store.closedSignals({ chatId });
      const open = (await deps.store.openSignals()).filter((s) => s.chat_id === chatId);
      const byModel = new Map<string, typeof rows>();
      for (const r of rows) {
        const k = `${r.timeframe}${r.model_key.startsWith("pooled:") ? " (общая)" : ""}`;
        byModel.set(k, [...(byModel.get(k) ?? []), r]);
      }
      const scan = scannerState();
      return [
        formatTrackRecord("Всего", trackRecord(rows)),
        ...(rows.some((r) => r.demo_status === "closed")
          ? [formatTrackRecord("Демо OKX (реальное исполнение)", trackRecord(rows.filter((r) => r.demo_status === "closed").map((r) => ({ net_bp: r.demo_net_bp ?? 0 }))))]
          : []),
        ...[...byModel].map(([k, v]) => formatTrackRecord(`  ${k}`, trackRecord(v))),
        `Открыто сейчас: ${open.length}${open.length ? ` (${open.map((s) => `${s.side} ${s.symbol} ${s.timeframe}`).join(", ")})` : ""}`,
        scan.lastScanAt ? `Последняя проверка: ${new Date(scan.lastScanAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    case "pause":
      await deps.store.setChat(chatId, { paused: true });
      return "⏸ Новые сигналы остановлены. Открытые досчитаются, итоги придут. /resume — возобновить.";

    case "resume":
      await deps.store.setChat(chatId, { paused: false });
      return "▶️ Сигналы снова включены.";

    case "observe": {
      const on = c.args[0]?.toLowerCase();
      if (on !== "on" && on !== "off") return "Укажите: /observe on или /observe off";
      await deps.store.setChat(chatId, { observe: on === "on" });
      return on === "on"
        ? "👀 Наблюдения включены: буду писать, когда модель с подтверждённой точностью направления уверенно смотрит вверх или вниз. Это не торговые сигналы — прибыль после комиссий для них не подтверждена."
        : "Наблюдения выключены. Только проверенные сигналы.";
    }

    case "news": {
      const on = c.args[0]?.toLowerCase();
      if (on !== "on" && on !== "off") return "Укажите: /news on или /news off";
      await deps.store.setChat(chatId, { news: on === "on" });
      return on === "on"
        ? "📰 Новостные алерты включены: пришлю, когда новость сильно и срочно влияет на монету. Это оценка новости, а не проверенная стратегия — в каждом алерте будет её реальная точность на прошлых новостях."
        : "Новостные алерты выключены.";
    }

    case "listings": {
      const on = c.args[0]?.toLowerCase();
      if (on !== "on" && on !== "off") return "Укажите: /listings on или /listings off";
      await deps.store.setChat(chatId, { listings: on === "on" });
      return on === "on"
        ? "🆕 Уведомления о новых монетах на OKX включены: анонс листинга, сводка по монете со статистикой прошлых листингов и итог через сутки."
        : "Уведомления о новых монетах выключены.";
    }

    default:
      return "Такой команды нет.\n\n" + HELP;
  }
}

function readOffset(): number {
  try {
    return (JSON.parse(fs.readFileSync(OFFSET_FILE, "utf-8")) as { offset: number }).offset;
  } catch {
    return 0;
  }
}

function writeOffset(offset: number): void {
  fs.mkdirSync(path.dirname(OFFSET_FILE), { recursive: true });
  fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset }) + "\n");
}

interface Update {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
}

/** One long-poll round; returns how many messages were answered. */
export async function pollOnce(config: TelegramConfig, deps: BotDeps = defaultDeps): Promise<number> {
  const { data } = await axios.get<{ ok: boolean; result: Update[] }>(`https://api.telegram.org/bot${config.token}/getUpdates`, {
    params: { offset: readOffset(), timeout: 25, allowed_updates: JSON.stringify(["message"]) },
    timeout: 35_000,
  });
  let answered = 0;
  for (const u of data.result) {
    writeOffset(u.update_id + 1);
    const msg = u.message;
    if (!msg?.text || String(msg.chat.id) !== config.chatId) continue;
    const reply = await handleCommand(config.chatId, msg.text, deps).catch((e) => `Ошибка: ${(e as Error).message}`);
    await sendTelegram(reply, config);
    answered++;
  }
  return answered;
}

let running = false;

/** Keeps polling while a bot is connected; waits quietly while it is not. */
export function startBot(): void {
  if (running) return;
  running = true;
  const loop = async () => {
    const config = getTelegramConfig();
    if (!config) return setTimeout(loop, 30_000);
    try {
      await pollOnce(config);
      setTimeout(loop, 0);
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      // 409: another getUpdates (the admin page connecting a bot) — back off and retry.
      if (status !== 409) console.warn("[telegram-bot]", (e as Error).message.replace(/bot\d+:[\w-]+/g, "bot***"));
      setTimeout(loop, 15_000);
    }
  };
  void loop();
}
