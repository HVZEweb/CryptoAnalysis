import type { Candle, Timeframe } from "@/types";

export interface TimeframeCandleConfig {
  primaryInterval: string;
  contextIntervals: string[];
  aggregateFrom?: string;
  aggregateCount?: number;
}

export const TIMEFRAME_CANDLE_CONFIG: Record<Timeframe, TimeframeCandleConfig> = {
  "15m": { primaryInterval: "15m", contextIntervals: ["15m", "1h", "4h"] },
  "30m": { primaryInterval: "30m", contextIntervals: ["30m", "1h", "4h"] },
  "1h": { primaryInterval: "1h", contextIntervals: ["1h", "4h", "1d"] },
  "4h": { primaryInterval: "4h", contextIntervals: ["4h", "1h", "1d"] },
  "12h": {
    primaryInterval: "12h",
    contextIntervals: ["4h", "1d"],
    aggregateFrom: "1h",
    aggregateCount: 12,
  },
  "24h": { primaryInterval: "1d", contextIntervals: ["1d", "4h", "1h"] },
  "3d": {
    primaryInterval: "3d",
    contextIntervals: ["1d", "4h"],
    aggregateFrom: "1d",
    aggregateCount: 3,
  },
  "7d": {
    primaryInterval: "7d",
    contextIntervals: ["1d", "4h"],
    aggregateFrom: "1d",
    aggregateCount: 7,
  },
};

export function aggregateCandles(candles: Candle[], count: number): Candle[] {
  if (candles.length < count) return candles;
  const result: Candle[] = [];

  for (let i = 0; i <= candles.length - count; i += count) {
    const chunk = candles.slice(i, i + count);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    result.push({
      openTime: first.openTime,
      open: first.open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: last.close,
      volume: chunk.reduce((sum, c) => sum + c.volume, 0),
      closeTime: last.closeTime,
      quoteVolume: chunk.reduce((sum, c) => sum + c.quoteVolume, 0),
      trades: chunk.reduce((sum, c) => sum + c.trades, 0),
      takerBuyVolume: chunk.every((c) => c.takerBuyVolume !== undefined)
        ? chunk.reduce((sum, c) => sum + (c.takerBuyVolume ?? 0), 0)
        : undefined,
    });
  }

  return result.slice(-200);
}

export function getIntervalsForTimeframe(timeframe: Timeframe): {
  fetchIntervals: string[];
  configs: TimeframeCandleConfig;
} {
  const configs = TIMEFRAME_CANDLE_CONFIG[timeframe];
  const fetchSet = new Set([
    ...configs.contextIntervals,
    configs.primaryInterval,
    configs.aggregateFrom ?? "",
  ].filter(Boolean));

  return { fetchIntervals: Array.from(fetchSet), configs };
}
