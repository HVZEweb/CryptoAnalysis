import { NextResponse } from "next/server";
import { denyUnlessAdmin } from "@/lib/admin-auth";
import {
  botUsername,
  clearTelegramSettings,
  getTelegramConfig,
  latestPrivateChat,
  saveTelegramSettings,
  sendTelegram,
  telegramError,
} from "@/lib/telegram";
import { loadModelEntries, scannerState } from "@/services/signal-scanner";
import { closedSignals, getWatchlist, openSignals } from "@/services/signals/store";
import { formatTrackRecord, trackRecord } from "@/services/signals/logic";
import { HELP } from "@/services/signals/bot";

export const dynamic = "force-dynamic";

function profitableModels(): string[] {
  return loadModelEntries()
    .filter((e) => e.model.strategy?.profitable)
    .map((e) => `${e.timeframe}${e.kind === "pooled" ? " (общая)" : ""}`);
}

function statusText(): string {
  const models = profitableModels();
  const head = models.length
    ? `Проверку прошли стратегии: ${models.join(", ")}.`
    : "Сейчас ни одна стратегия не прошла проверку на новых данных, поэтому сигналов не будет, пока переобучение не найдёт прибыльную настройку. Об этом придёт отдельное сообщение.";
  return `${head}\n\nДобавьте монеты командой /watch, например: /watch BTC ETH SOL\n\n${HELP}`;
}

export async function GET(request: Request) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;
  const config = getTelegramConfig();
  const state = scannerState();
  const [watchlist, open, closed] = config
    ? await Promise.all([getWatchlist(config.chatId), openSignals(), closedSignals({ chatId: config.chatId })])
    : [[], [], []];
  return NextResponse.json({
    connected: Boolean(config),
    source: config?.source ?? null,
    profitableTimeframes: profitableModels(),
    lastScanAt: state.lastScanAt ?? null,
    lastSignalAt: state.lastSignalAt ?? null,
    openSignals: open.map((s) => `${s.side} ${s.symbol} ${s.timeframe}`),
    watchlist,
    trackRecord: formatTrackRecord("Результаты сигналов", trackRecord(closed)),
  });
}

export async function POST(request: Request) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { action?: string; token?: string };

  try {
    if (body.action === "connect") {
      const token = body.token?.trim() ?? "";
      if (!/^\d+:[\w-]{30,}$/.test(token)) {
        return NextResponse.json({ error: "Это не похоже на токен бота. Он выглядит так: 123456789:AAE…" }, { status: 400 });
      }
      const username = await botUsername(token);
      const chat = await latestPrivateChat(token);
      if (!chat) {
        return NextResponse.json(
          { error: `Бот @${username} найден. Откройте его в Telegram, нажмите «Start» (или напишите что угодно) и нажмите «Подключить» ещё раз.` },
          { status: 400 }
        );
      }
      saveTelegramSettings({ token, chatId: chat.chatId });
      await sendTelegram(`🤖 Бот подключён к CryptoAnalysis.\n${statusText()}`);
      return NextResponse.json({ ok: true, message: `Подключено: @${username} пишет ${chat.name}. Проверьте Telegram.` });
    }
    if (body.action === "test") {
      if (!(await sendTelegram(`🔔 Проверка связи.\n${statusText()}`))) {
        return NextResponse.json({ error: "Бот не подключён" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, message: "Сообщение отправлено" });
    }
    if (body.action === "disconnect") {
      clearTelegramSettings();
      return NextResponse.json({ ok: true, message: "Бот отключён" });
    }
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: `Telegram: ${telegramError(e)}` }, { status: 502 });
  }
}
