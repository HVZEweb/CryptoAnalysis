import { NextRequest, NextResponse } from "next/server";
import {
  fetchTradingAnalytics,
  pingTradingBot,
  TAB_TO_STRATEGY,
  type TradingStrategy,
} from "@/lib/trading-bot-client";
import { getTradingAnalyticsFromDb } from "@/lib/trading-bot-db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get("tab");
    const strategyParam = searchParams.get("strategy");
    const limit = Number(searchParams.get("limit") ?? "500");

    let strategy: TradingStrategy | "all" | undefined;
    if (strategyParam) {
      strategy = strategyParam as TradingStrategy | "all";
    } else if (tab && TAB_TO_STRATEGY[tab]) {
      strategy = TAB_TO_STRATEGY[tab];
    }

    const online = await pingTradingBot();
    const analytics =
      online && (await fetchTradingAnalytics(strategy, limit)) ?? (await getTradingAnalyticsFromDb(strategy));

    return NextResponse.json({ success: true, data: analytics });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
