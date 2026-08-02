import { NextRequest, NextResponse } from "next/server";
import {
  evaluatePredictionAccuracyFromPrices,
  getCandleIntervalForTimeframe,
  getTimeframeDurationMs,
} from "@/lib/accuracy";
import { resolveCoinBySymbol } from "@/lib/coins";
import { resolvePriceForecast } from "@/lib/price-forecast";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { fetchCandlesInRange, fetchCurrentPrice } from "@/services/binance";
import type { MarketType, PredictionDirection, PriceForecast, Timeframe } from "@/types";

const MAX_ITEMS = 100;

interface AccuracyRequestItem {
  symbol: string;
  market: MarketType;
  direction: PredictionDirection;
  priceAtPrediction: number;
  timeframe?: Timeframe;
  createdAt?: string;
  priceRange?: { low: number; high: number };
  priceForecast?: PriceForecast;
  tradeLevels?: { entry: number; tp: number; sl: number; exit: number };
}

async function resolveActualPrice(item: AccuracyRequestItem): Promise<{
  actualPrice: number;
  candles: Awaited<ReturnType<typeof fetchCandlesInRange>>;
}> {
  const currentPrice = await fetchCurrentPrice(item.symbol, item.market);

  if (!item.createdAt || !item.timeframe) {
    return { actualPrice: currentPrice, candles: [] };
  }

  const start = new Date(item.createdAt).getTime();
  const durationMs = getTimeframeDurationMs(item.timeframe);
  const end = Math.min(start + durationMs, Date.now());
  const interval = getCandleIntervalForTimeframe(item.timeframe);

  try {
    const candles = await fetchCandlesInRange(
      item.symbol,
      interval,
      item.market,
      start,
      end
    );

    const completed = Date.now() - start >= durationMs;
    const actualPrice =
      completed && candles.length > 0 ? candles[candles.length - 1].close : currentPrice;

    return { actualPrice, candles };
  } catch {
    return { actualPrice: currentPrice, candles: [] };
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = await checkRateLimit(`accuracy:${ip}`, 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  }

  try {
    const body = (await request.json()) as { items: AccuracyRequestItem[] };

    if (!body.items?.length || body.items.length > MAX_ITEMS) {
      return NextResponse.json(
        { error: `От 1 до ${MAX_ITEMS} элементов за запрос` },
        { status: 400 }
      );
    }

    const results = await Promise.all(
      body.items.map(async (item) => {
        try {
          if (!item.priceAtPrediction || item.priceAtPrediction <= 0) {
            return {
              ...item,
              currentPrice: null,
              label: "Нет данных",
              percentChange: 0,
              isCorrect: null,
              explanation: "Нет цены на момент прогноза",
              score: 0,
              priceErrorPct: 0,
              predictedPrice: 0,
              actualPrice: 0,
              breakdown: null,
              details: [],
            };
          }

          const forecast = item.priceForecast ?? resolvePriceForecast({
            direction: item.direction,
            priceAtPrediction: item.priceAtPrediction,
            priceRange: item.priceRange ?? {
              low: item.priceAtPrediction * 0.98,
              high: item.priceAtPrediction * 1.02,
            },
            tradeLevels: item.tradeLevels,
          });
          const { actualPrice, candles } = await resolveActualPrice(item);

          const accuracy = evaluatePredictionAccuracyFromPrices(
            {
              direction: item.direction,
              priceAtPrediction: item.priceAtPrediction,
              timeframe: item.timeframe,
              createdAt: item.createdAt,
              priceRange: item.priceRange,
              priceForecast: forecast,
              tradeLevels: item.tradeLevels,
            },
            actualPrice,
            candles
          );

          return {
            ...item,
            currentPrice: actualPrice,
            ...accuracy,
          };
        } catch {
          return {
            ...item,
            currentPrice: null,
            label: "Нет данных",
            percentChange: 0,
            isCorrect: null,
            explanation: "Не удалось получить данные для оценки",
            score: 0,
            priceErrorPct: 0,
            predictedPrice: item.priceForecast?.predictedPrice ?? 0,
            actualPrice: 0,
            breakdown: null,
            details: [],
          };
        }
      })
    );

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Ошибка проверки точности" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = await checkRateLimit(`accuracy:${ip}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  }

  const symbol = request.nextUrl.searchParams.get("symbol");
  const market = (request.nextUrl.searchParams.get("market") ?? "Futures") as MarketType;
  const direction = request.nextUrl.searchParams.get("direction") as PredictionDirection;
  const priceAt = parseFloat(request.nextUrl.searchParams.get("priceAt") ?? "0");
  const timeframe = request.nextUrl.searchParams.get("timeframe") as Timeframe | null;
  const createdAt = request.nextUrl.searchParams.get("createdAt") ?? undefined;
  const predictedPrice = parseFloat(request.nextUrl.searchParams.get("predictedPrice") ?? "0");

  if (!symbol || !priceAt) {
    return NextResponse.json({ error: "Неверные параметры" }, { status: 400 });
  }

  await resolveCoinBySymbol(symbol);

  const item: AccuracyRequestItem = {
    symbol,
    market,
    direction,
    priceAtPrediction: priceAt,
    timeframe: timeframe ?? undefined,
    createdAt,
    priceForecast:
      predictedPrice > 0
        ? {
            predictedPrice,
            predictedHigh: predictedPrice,
            predictedLow: predictedPrice,
            confidenceBand: { low: predictedPrice, high: predictedPrice },
            expectedMovePct: ((predictedPrice - priceAt) / priceAt) * 100,
          }
        : undefined,
  };

  const { actualPrice, candles } = await resolveActualPrice(item);
  const accuracy = evaluatePredictionAccuracyFromPrices(item, actualPrice, candles);

  return NextResponse.json({ currentPrice: actualPrice, ...accuracy });
}
