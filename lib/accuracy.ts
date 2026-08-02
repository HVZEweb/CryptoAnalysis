import { TIMEFRAME_CANDLE_CONFIG } from "@/lib/timeframe";
import { resolvePriceForecast } from "@/lib/price-forecast";
import type { Candle, MarketType, PredictionDirection, PriceForecast, Timeframe } from "@/types";

function formatPrice(value: number): string {
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

export const TIMEFRAME_DURATION_MS: Record<string, number> = {
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "3d": 3 * 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
};

/** Допустимая погрешность прогноза цены (%), по таймфрейму */
const TIMEFRAME_PRICE_TOLERANCE: Record<string, number> = {
  "15m": 0.35,
  "30m": 0.5,
  "1h": 0.75,
  "4h": 1.2,
  "12h": 1.8,
  "24h": 2.5,
  "3d": 4.0,
  "7d": 6.0,
};

export interface AccuracyInput {
  direction: PredictionDirection;
  priceAtPrediction: number;
  timeframe?: Timeframe | string;
  createdAt?: string;
  priceRange?: { low: number; high: number };
  priceForecast?: PriceForecast;
  tradeLevels?: { entry: number; tp: number; sl: number; exit: number };
}

export interface AccuracyBreakdown {
  price: number;
  direction: number;
  range: number;
  band: number;
  path: number;
}

export interface AccuracyEvaluation {
  label: string;
  percentChange: number;
  isCorrect: boolean | null;
  explanation: string;
  timeframePhase: "in_progress" | "completed";
  score: number;
  priceErrorPct: number;
  predictedPrice: number;
  actualPrice: number;
  breakdown: AccuracyBreakdown;
  details: string[];
}

function formatDurationMinutes(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} мин`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem > 0 ? `${hours} ч ${rem} мин` : `${hours} ч`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days} д ${remH} ч` : `${days} д`;
}

function scorePriceAccuracy(errorPct: number, tolerance: number): number {
  if (errorPct <= tolerance * 0.15) return 100;
  if (errorPct <= tolerance * 0.35) return 95;
  if (errorPct <= tolerance * 0.6) return 88;
  if (errorPct <= tolerance) return 78;
  if (errorPct <= tolerance * 1.5) return 62;
  if (errorPct <= tolerance * 2.5) return 45;
  if (errorPct <= tolerance * 4) return 25;
  return Math.max(0, 15 - errorPct);
}

function scoreDirection(
  direction: PredictionDirection,
  movePct: number,
  threshold: number
): number {
  if (direction === "LONG") {
    if (movePct > threshold * 0.3) return 100;
    if (movePct > 0) return 75;
    if (movePct > -threshold) return 40;
    return 0;
  }
  if (direction === "SHORT") {
    if (movePct < -threshold * 0.3) return 100;
    if (movePct < 0) return 75;
    if (movePct < threshold) return 40;
    return 0;
  }
  if (Math.abs(movePct) <= threshold * 1.2) return 100;
  if (Math.abs(movePct) <= threshold * 2) return 55;
  return 0;
}

function analyzePath(
  candles: Candle[],
  direction: PredictionDirection,
  entry: number,
  tp: number,
  sl: number
): { score: number; tpHit: boolean; slHit: boolean; mfePct: number; maePct: number } {
  if (!candles.length || entry <= 0) {
    return { score: 50, tpHit: false, slHit: false, mfePct: 0, maePct: 0 };
  }

  let tpHit = false;
  let slHit = false;
  let slFirst = false;
  let maxHigh = entry;
  let minLow = entry;

  for (const c of candles) {
    maxHigh = Math.max(maxHigh, c.high);
    minLow = Math.min(minLow, c.low);

    if (!tpHit && !slHit) {
      if (direction === "LONG") {
        if (c.low <= sl) {
          slHit = true;
          slFirst = true;
        } else if (c.high >= tp) {
          tpHit = true;
        }
      } else if (direction === "SHORT") {
        if (c.high >= sl) {
          slHit = true;
          slFirst = true;
        } else if (c.low <= tp) {
          tpHit = true;
        }
      }
    }
  }

  const mfePct = direction === "SHORT" ? ((entry - minLow) / entry) * 100 : ((maxHigh - entry) / entry) * 100;
  const maePct = direction === "SHORT" ? ((maxHigh - entry) / entry) * 100 : ((entry - minLow) / entry) * 100;

  let score = 50;
  if (tpHit && !slFirst) score = 100;
  else if (tpHit && slFirst) score = 35;
  else if (slHit) score = 10;
  else if (direction === "SIDEWAYS") score = maePct < 1.5 ? 80 : 40;

  return { score, tpHit, slHit, mfePct, maePct };
}

export function evaluatePredictionAccuracyFromPrices(
  input: AccuracyInput,
  actualPrice: number,
  candles: Candle[] = []
): AccuracyEvaluation {
  const entry = input.priceAtPrediction;
  if (!entry || entry <= 0 || !actualPrice) {
    return {
      label: "Нет данных",
      percentChange: 0,
      isCorrect: null,
      explanation: "Нет цены на момент прогноза — оценка недоступна",
      timeframePhase: "in_progress",
      score: 0,
      priceErrorPct: 0,
      predictedPrice: 0,
      actualPrice: actualPrice || 0,
      breakdown: { price: 0, direction: 0, range: 0, band: 0, path: 0 },
      details: [],
    };
  }

  const forecast =
    input.priceForecast ??
    resolvePriceForecast({
      direction: input.direction,
      priceAtPrediction: entry,
      priceRange: input.priceRange ?? {
        low: entry * 0.98,
        high: entry * 1.02,
      },
      tradeLevels: input.tradeLevels,
    });
  const predictedPrice = forecast.predictedPrice;
  const tf = input.timeframe ?? "24h";
  const durationMs = TIMEFRAME_DURATION_MS[tf] ?? TIMEFRAME_DURATION_MS["24h"];
  const tolerance = TIMEFRAME_PRICE_TOLERANCE[tf] ?? 2.5;
  const elapsedMs = input.createdAt ? Date.now() - new Date(input.createdAt).getTime() : durationMs;
  const earlyFraction = tf === "15m" || tf === "30m" ? 0.45 : 0.3;
  const timeframePhase: "in_progress" | "completed" =
    elapsedMs >= durationMs ? "completed" : "in_progress";

  const percentChange = ((actualPrice - entry) / entry) * 100;
  const priceErrorPct = (Math.abs(actualPrice - predictedPrice) / entry) * 100;
  const progress = Math.min(1, elapsedMs / durationMs);
  const dynamicThreshold = tolerance * (0.55 + 0.45 * progress);

  if (input.createdAt && elapsedMs < durationMs * earlyFraction) {
    return {
      label: "В процессе",
      percentChange,
      isCorrect: null,
      explanation: `Прошло ${formatDurationMinutes(elapsedMs)} из ${formatDurationMinutes(durationMs)}. Целевая: $${formatPrice(predictedPrice)}, сейчас: $${formatPrice(actualPrice)} (ошибка ${priceErrorPct.toFixed(2)}%).`,
      timeframePhase,
      score: 0,
      priceErrorPct,
      predictedPrice,
      actualPrice,
      breakdown: { price: 0, direction: 0, range: 0, band: 0, path: 0 },
      details: [],
    };
  }

  const inRange =
    input.priceRange &&
    input.priceRange.low > 0 &&
    input.priceRange.high > 0 &&
    actualPrice >= input.priceRange.low &&
    actualPrice <= input.priceRange.high;

  const inBand =
    forecast.confidenceBand.low > 0 &&
    forecast.confidenceBand.high > 0 &&
    actualPrice >= forecast.confidenceBand.low &&
    actualPrice <= forecast.confidenceBand.high;

  const priceScore = scorePriceAccuracy(priceErrorPct, tolerance);
  const directionScore = scoreDirection(input.direction, percentChange, dynamicThreshold);
  const rangeScore = inRange ? 100 : 0;
  const bandScore = inBand ? 100 : Math.max(0, 100 - (priceErrorPct / tolerance) * 40);

  const levels = input.tradeLevels;
  const tp = levels?.tp ?? forecast.predictedHigh;
  const sl = levels?.sl ?? forecast.predictedLow;
  const path = analyzePath(candles, input.direction, entry, tp, sl);

  const breakdown: AccuracyBreakdown = {
    price: Math.round(priceScore),
    direction: Math.round(directionScore),
    range: Math.round(rangeScore),
    band: Math.round(bandScore),
    path: Math.round(path.score),
  };

  const score = Math.round(
    breakdown.price * 0.45 +
      breakdown.direction * 0.2 +
      breakdown.range * 0.1 +
      breakdown.band * 0.15 +
      breakdown.path * 0.1
  );

  const details: string[] = [
    `Цена: ${breakdown.price}/100 (ошибка ${priceErrorPct.toFixed(2)}%, допуск ±${tolerance}%)`,
    `Направление: ${breakdown.direction}/100 (${percentChange >= 0 ? "+" : ""}${percentChange.toFixed(2)}%)`,
    `Диапазон: ${breakdown.range}/100`,
    `Коридор: ${breakdown.band}/100 ($${formatPrice(forecast.confidenceBand.low)}–$${formatPrice(forecast.confidenceBand.high)})`,
  ];

  if (candles.length > 0) {
    details.push(
      `Путь: ${breakdown.path}/100${path.tpHit ? ", TP достигнут" : ""}${path.slHit ? ", SL пробит" : ""}`
    );
  }

  const phaseNote = timeframePhase === "completed" ? " Таймфрейм завершён." : " Промежуточная оценка.";

  let label: string;
  let isCorrect: boolean | null;

  if (timeframePhase === "in_progress") {
    label = score >= 75 ? "На траектории" : score >= 50 ? "Уточняется" : "Отклонение";
    isCorrect = null;
  } else if (score >= 72) {
    label = "Точно";
    isCorrect = true;
  } else if (score >= 48) {
    label = "Частично";
    isCorrect = null;
  } else {
    label = "Мимо";
    isCorrect = false;
  }

  const explanation =
    `Прогноз $${formatPrice(predictedPrice)} → факт $${formatPrice(actualPrice)}. ` +
    `Итог ${score}/100.${phaseNote}`;

  return {
    label,
    percentChange,
    isCorrect,
    explanation,
    timeframePhase,
    score,
    priceErrorPct,
    predictedPrice,
    actualPrice,
    breakdown,
    details,
  };
}

/** @deprecated Используйте evaluatePredictionAccuracyFromPrices — оставлено для совместимости тестов */
export function evaluatePredictionAccuracy(
  direction: PredictionDirection,
  priceAtPrediction: number,
  currentPrice: number,
  options: {
    timeframe?: string;
    createdAt?: string;
    priceRange?: { low: number; high: number };
    priceForecast?: PriceForecast;
    tradeLevels?: { entry: number; tp: number; sl: number; exit: number };
  } = {}
): Omit<AccuracyEvaluation, "score" | "priceErrorPct" | "predictedPrice" | "actualPrice" | "breakdown" | "details"> {
  const full = evaluatePredictionAccuracyFromPrices(
    { direction, priceAtPrediction, ...options },
    currentPrice
  );
  return {
    label: full.label,
    percentChange: full.percentChange,
    isCorrect: full.isCorrect,
    explanation: full.explanation,
    timeframePhase: full.timeframePhase,
  };
}

export function getCandleIntervalForTimeframe(timeframe: string): string {
  return TIMEFRAME_CANDLE_CONFIG[timeframe as Timeframe]?.primaryInterval ?? "1h";
}

export function getTimeframeDurationMs(timeframe: string): number {
  return TIMEFRAME_DURATION_MS[timeframe] ?? TIMEFRAME_DURATION_MS["24h"];
}

export async function fetchCandlesForAccuracyWindow(
  fetchCandles: (
    symbol: string,
    interval: string,
    market: MarketType,
    startTime: number,
    endTime: number
  ) => Promise<Candle[]>,
  symbol: string,
  market: MarketType,
  timeframe: string,
  createdAt: string
): Promise<Candle[]> {
  const start = new Date(createdAt).getTime();
  const end = start + getTimeframeDurationMs(timeframe);
  const interval = getCandleIntervalForTimeframe(timeframe);
  return fetchCandles(symbol, interval, market, start, end);
}
