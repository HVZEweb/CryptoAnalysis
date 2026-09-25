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
import { ALL_TIMEFRAMES } from "@/services/predictor/config";
import { loadModel } from "@/services/predictor";
import { scannerState } from "@/services/signal-scanner";

export const dynamic = "force-dynamic";

function profitableTimeframes(): string[] {
  return ALL_TIMEFRAMES.filter((tf) => loadModel(tf)?.strategy?.profitable);
}

function statusText(): string {
  const tfs = profitableTimeframes();
  return tfs.length
    ? `Проверку прошли стратегии на ${tfs.join(", ")} — по ним приходят сигналы.`
    : "Сейчас ни одна стратегия не прошла проверку на новых данных, поэтому сигналов не будет, пока переобучение не найдёт прибыльную настройку. Об этом придёт отдельное сообщение.";
}

export async function GET(request: Request) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;
  const config = getTelegramConfig();
  const state = scannerState();
  return NextResponse.json({
    connected: Boolean(config),
    source: config?.source ?? null,
    profitableTimeframes: profitableTimeframes(),
    lastScanAt: state.lastScanAt ?? null,
    lastSignalAt: state.lastSignalAt ?? null,
    openSignals: Object.keys(state.busyUntil ?? {}),
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
