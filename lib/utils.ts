import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: number, decimals = 2): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(decimals)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(decimals)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(decimals)}K`;
  return value.toFixed(decimals);
}

export function formatPrice(value: number): string {
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4);
  if (value >= 0.01) return value.toFixed(6);
  return value.toFixed(8);
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Ключ для слияния локальной и серверной истории (createdAt может отличаться на секунды). */
export function historyDedupKey(item: {
  symbol: string;
  market: string;
  timeframe: string;
  direction: string;
  priceAtPrediction: number;
  createdAt?: string;
}): string {
  const minute = item.createdAt
    ? Math.floor(new Date(item.createdAt).getTime() / 60_000)
    : 0;
  const price = Math.round(item.priceAtPrediction * 100) / 100;
  return `${item.symbol}|${item.market}|${item.timeframe}|${item.direction}|${price}|${minute}`;
}

export function dedupeHistoryItems<T extends {
  symbol: string;
  market: string;
  timeframe: string;
  direction: string;
  priceAtPrediction: number;
  createdAt?: string;
}>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = historyDedupKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export const TIMEFRAME_LABELS: Record<string, string> = {
  "15m": "15 минут",
  "30m": "30 минут",
  "1h": "1 час",
  "4h": "4 часа",
  "12h": "12 часов",
  "24h": "24 часа",
  "3d": "3 дня",
  "7d": "7 дней",
};

export const DIRECTION_CONFIG = {
  LONG: { emoji: "🟢", label: "LONG", color: "text-emerald-400" },
  SHORT: { emoji: "🔴", label: "SHORT", color: "text-red-400" },
  SIDEWAYS: { emoji: "🟡", label: "БОКОВИК", color: "text-amber-400" },
} as const;

export const MARKET_LABELS: Record<string, string> = {
  Spot: "Спот",
  Futures: "Фьючерсы",
};

export const CONFIDENCE_LABELS: Record<string, string> = {
  High: "Высокий",
  Medium: "Средний",
  Low: "Низкий",
};

export {
  evaluatePredictionAccuracy,
  evaluatePredictionAccuracyFromPrices,
  type AccuracyEvaluation,
  type AccuracyBreakdown,
  type AccuracyInput,
} from "@/lib/accuracy";
