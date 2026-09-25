import { denyUnlessAdmin } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { resolveCoinBySymbol } from "@/lib/coins";
import { backtester } from "@/lib/backtesting/backtester";
import { listBacktestRuns, loadBacktestRun } from "@/lib/backtesting/runs-store";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { backtestFormSchema } from "@/lib/schemas";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;

  const ip = getClientIp(request);
  const burst = await checkRateLimit(`backtest:${ip}`, 3, 300_000);
  if (!burst.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMIT", message: `Повторите через ${burst.retryAfterSec} сек.` } },
      { status: 429 }
    );
  }

  try {
    const body: unknown = await request.json();
    const parsed = backtestFormSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Неверные параметры backtest." } },
        { status: 400 }
      );
    }

    const coin = await resolveCoinBySymbol(parsed.data.coinSymbol);
    const report = await backtester.run(
      {
        symbol: coin.symbol,
        market: parsed.data.market,
        timeframe: parsed.data.timeframe,
        periodDays: parsed.data.periodDays,
        mode: parsed.data.mode,
        maxTrades: parsed.data.maxTrades,
        useDynamicWeights: parsed.data.useDynamicWeights,
        walkForward: parsed.data.walkForward,
        exportTraining: parsed.data.exportTraining,
        retrainMl: parsed.data.retrainMl,
      },
      coin
    );

    const { trainingRecords: _omit, ...clientReport } = report;
    return NextResponse.json({ report: clientReport });
  } catch (error) {
    const err = error as { code?: string; message?: string };
    return NextResponse.json(
      { error: { code: err.code ?? "UNKNOWN", message: err.message ?? "Backtest failed" } },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;

  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    const report = await loadBacktestRun(id);
    if (!report) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Backtest run not found" } },
        { status: 404 }
      );
    }
    return NextResponse.json({ report });
  }

  const runs = await listBacktestRuns();
  return NextResponse.json({ runs });
}
