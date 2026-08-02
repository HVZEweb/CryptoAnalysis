import type { PredictionHistoryItem } from "@/types";
import { historyDedupKey } from "@/lib/utils";
import { resolvePriceForecast } from "@/lib/price-forecast";

const BATCH_SIZE = 15;

export interface AccuracyApiResult {
  symbol: string;
  market: string;
  direction: string;
  priceAtPrediction: number;
  timeframe?: string;
  createdAt?: string;
  currentPrice: number | null;
  label: string;
  percentChange: number | null;
  isCorrect: boolean | null;
  timeframePhase?: "in_progress" | "completed";
  explanation?: string;
  score?: number;
  priceErrorPct?: number;
  predictedPrice?: number;
  breakdown?: { price: number; direction: number; range: number; band: number; path: number } | null;
  details?: string[];
}

function toApiItem(h: PredictionHistoryItem) {
  return {
    symbol: h.symbol,
    market: h.market,
    direction: h.direction,
    priceAtPrediction: h.priceAtPrediction ?? 0,
    timeframe: h.timeframe,
    createdAt: h.createdAt,
    priceRange: h.priceRange,
    priceForecast: h.priceForecast ?? resolvePriceForecast(h),
    tradeLevels: h.tradeLevels,
  };
}

export async function fetchAccuracyResults(
  items: PredictionHistoryItem[]
): Promise<{ results: AccuracyApiResult[]; error?: string }> {
  if (items.length === 0) return { results: [] };

  const all: AccuracyApiResult[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const res = await fetch("/api/accuracy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: batch.map(toApiItem) }),
    });

    const data = (await res.json()) as { results?: AccuracyApiResult[]; error?: string };

    if (!res.ok) {
      return {
        results: all,
        error: data.error ?? `Ошибка API (${res.status})`,
      };
    }

    all.push(...(data.results ?? []));
  }

  return { results: all };
}

export function mapAccuracyByHistoryKey(
  history: PredictionHistoryItem[],
  results: AccuracyApiResult[]
): Map<string, AccuracyApiResult> {
  const map = new Map<string, AccuracyApiResult>();

  for (const h of history) {
    const key = historyDedupKey(h);
    const match = results.find(
      (r) =>
        historyDedupKey({
          symbol: r.symbol,
          market: h.market,
          timeframe: (r.timeframe ?? h.timeframe) as string,
          direction: r.direction,
          priceAtPrediction: r.priceAtPrediction,
          createdAt: r.createdAt ?? h.createdAt,
        }) === key
    );
    if (match) map.set(key, match);
  }

  return map;
}
