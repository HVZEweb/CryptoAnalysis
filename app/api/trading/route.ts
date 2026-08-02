import { NextRequest, NextResponse } from "next/server";
import {
  fetchTradingBotStatus,
  fetchTradingPositions,
  fetchTradingTrades,
  pingTradingBot,
  setTradingMode,
  stopTradingBotHttp,
  TAB_TO_STRATEGY,
  updateTradingConfig,
  type TradingStrategy,
} from "@/lib/trading-bot-client";
import { getTradingStatusFromDb, getTradingTrades } from "@/lib/trading-bot-db";
import {
  isTradingBotProcessRunning,
  readTradingLogTail,
  startTradingBotProcess,
  stopTradingBotProcess,
} from "@/lib/trading-bot-process";

export async function GET() {
  try {
    const online = await pingTradingBot();
    const live = online ? await fetchTradingBotStatus() : null;
    const status = live ?? (await getTradingStatusFromDb());
    const [trades, positions] = await Promise.all([
      online ? fetchTradingTrades(25) : getTradingTrades(25),
      online ? fetchTradingPositions() : Promise.resolve([]),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        online,
        process_running: isTradingBotProcessRunning(),
        status,
        trades,
        positions,
        log_tail: readTradingLogTail(40),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    switch (body.action) {
      case "start": {
        const result = startTradingBotProcess();
        if (!result.ok) {
          return NextResponse.json({ success: false, error: result.message }, { status: 400 });
        }
        await new Promise((r) => setTimeout(r, 3000));
        const online = await pingTradingBot();
        return NextResponse.json({
          success: true,
          message: online ? "Trading Bot запущен" : "Процесс стартовал, ждём API…",
          pid: result.pid,
          online,
        });
      }

      case "stop": {
        const httpStopped = await stopTradingBotHttp();
        const procStopped = stopTradingBotProcess();
        return NextResponse.json({
          success: true,
          message: "Trading Bot остановлен",
          httpStopped,
          procStopped,
        });
      }

      case "mode": {
        const mode = body.mode as "paper" | "live" | undefined;
        const tab = body.tab as string | undefined;
        const strategy = (body.strategy ?? (tab ? TAB_TO_STRATEGY[tab] : undefined)) as
          | TradingStrategy
          | undefined;
        if (!mode && !strategy) {
          return NextResponse.json({ success: false, error: "mode or strategy required" }, { status: 400 });
        }
        const ok = await setTradingMode(mode ?? "paper", strategy);
        return NextResponse.json({
          success: ok,
          message: ok ? "Режим обновлён" : "Бот офлайн — запустите процесс",
        });
      }

      case "updateConfig": {
        const ok = await updateTradingConfig(body.config ?? {});
        return NextResponse.json({
          success: ok,
          message: ok ? "Конфиг обновлён" : "Бот офлайн",
        });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
