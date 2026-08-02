import { resolvePriceForecast } from "@/lib/price-forecast";
import type { PredictionDirection, PredictionResult } from "@/types";

export interface TradeLevels {
  entry: number;
  exit: number;
  tp: number;
  sl: number;
  hint: string;
}

function pct(from: number, to: number): number {
  if (!from) return 0;
  return ((to - from) / from) * 100;
}

export function computeTradeLevels(prediction: Pick<
  PredictionResult,
  "direction" | "priceAtPrediction" | "priceRange" | "priceForecast" | "tradeLevels"
>): TradeLevels {
  const entry = prediction.priceAtPrediction;
  const forecast = resolvePriceForecast(prediction);
  const { low, high } = prediction.priceRange;

  const levels: Record<PredictionDirection, TradeLevels> = {
    LONG: {
      entry,
      tp: forecast.predictedHigh,
      sl: forecast.predictedLow,
      exit: forecast.predictedPrice,
      hint: "TP — прогноз max, exit — целевая цена закрытия",
    },
    SHORT: {
      entry,
      tp: forecast.predictedLow,
      sl: forecast.predictedHigh,
      exit: forecast.predictedPrice,
      hint: "TP — прогноз min, exit — целевая цена закрытия",
    },
    SIDEWAYS: {
      entry: forecast.predictedPrice,
      tp: high,
      sl: low,
      exit: forecast.predictedPrice,
      hint: "Боковик: целевая цена ≈ текущему коридору",
    },
  };

  return levels[prediction.direction];
}

/** Отбрасывает нереалистичные уровни от AI (часто у coding-моделей). */
export function sanitizeAiTradeLevels(
  raw: { entry: number; tp: number; sl: number; exit: number } | undefined,
  direction: PredictionDirection,
  entry: number
): { entry: number; tp: number; sl: number; exit: number } | undefined {
  if (!raw) return undefined;

  const levels = {
    entry,
    tp: raw.tp,
    sl: raw.sl,
    exit: raw.exit,
  };

  if ([levels.tp, levels.sl, levels.exit].some((v) => !Number.isFinite(v) || v <= 0)) {
    return undefined;
  }

  const nearEntry = (v: number) => Math.abs(v - entry) / entry <= 0.35;
  if (![levels.tp, levels.sl, levels.exit].every(nearEntry)) return undefined;

  if (direction === "LONG" && !(levels.tp > entry && levels.sl < entry)) return undefined;
  if (direction === "SHORT" && !(levels.tp < entry && levels.sl > entry)) return undefined;

  return levels;
}

function applySupportResistance(
  levels: TradeLevels,
  direction: PredictionDirection,
  support: number,
  resistance: number
): TradeLevels {
  if (direction === "LONG") {
    return {
      ...levels,
      sl: support > 0 && support < levels.entry ? support : levels.sl,
      tp: resistance > 0 && resistance > levels.entry ? resistance : levels.tp,
    };
  }

  if (direction === "SHORT") {
    return {
      ...levels,
      sl: resistance > 0 && resistance > levels.entry ? resistance : levels.sl,
      tp: support > 0 && support < levels.entry ? support : levels.tp,
    };
  }

  return levels;
}

/**
 * Единые уровни для карточки и вкладки «Анализ».
 * База: цена прогноза + диапазон AI + тех. поддержка/сопротивление.
 * Уровни AI подмешиваются только если проходят валидацию.
 */
export function resolveTradeLevels(prediction: PredictionResult): TradeLevels {
  const entry = prediction.priceAtPrediction;

  if (prediction.refinementNotes?.length && prediction.tradeLevels) {
    const t = prediction.tradeLevels;
    return {
      entry,
      tp: t.tp,
      sl: t.sl,
      exit: t.exit,
      hint: "ATR + старшие ТФ + R:R ≥ 1.5",
    };
  }

  let levels = computeTradeLevels({
    direction: prediction.direction,
    priceAtPrediction: entry,
    priceRange: prediction.priceRange,
    priceForecast: prediction.priceForecast,
    tradeLevels: prediction.tradeLevels,
  });

  const sr = prediction.analysis?.levels;
  if (sr) {
    levels = applySupportResistance(
      levels,
      prediction.direction,
      sr.nearestSupport,
      sr.nearestResistance
    );
  }

  const aiLevels = sanitizeAiTradeLevels(prediction.tradeLevels, prediction.direction, levels.entry);
  if (aiLevels) {
    levels = { ...levels, ...aiLevels, entry: levels.entry };
  }

  return levels;
}

export function formatLevelDelta(entry: number, price: number): string {
  const change = pct(entry, price);
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}
