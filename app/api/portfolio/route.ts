import { NextRequest, NextResponse } from "next/server";
import { evaluatePortfolioItems, type PortfolioRequestItem } from "@/lib/portfolio-eval";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const MAX_ITEMS = 100;

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = await checkRateLimit(`portfolio:${ip}`, 5, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  }

  try {
    const body = (await request.json()) as {
      items: PortfolioRequestItem[];
      marginUsd?: number;
      leverage?: number;
      notionalUsd?: number;
      virtualStart?: number;
    };

    if (!body.items?.length) {
      return NextResponse.json({ error: "Нет прогнозов для расчёта" }, { status: 400 });
    }

    if (body.items.length > MAX_ITEMS) {
      return NextResponse.json(
        { error: `Максимум ${MAX_ITEMS} прогнозов за один расчёт` },
        { status: 400 }
      );
    }

    const marginUsd = clampNumber(body.marginUsd ?? body.notionalUsd ?? 100, 1, 1_000_000);
    const leverage = clampNumber(body.leverage ?? 1, 1, 125);
    const virtualStart = body.virtualStart
      ? clampNumber(body.virtualStart, 1, 10_000_000)
      : undefined;

    const { summary } = await evaluatePortfolioItems(body.items, marginUsd, leverage, virtualStart);

    return NextResponse.json({ summary });
  } catch {
    return NextResponse.json({ error: "Ошибка расчёта портфеля" }, { status: 500 });
  }
}
