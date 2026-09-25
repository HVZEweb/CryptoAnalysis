import type { Timeframe } from "@/types";

/**
 * How each user-facing timeframe maps onto the model:
 * features are computed on `interval` bars, the target is the close `horizon` bars ahead.
 */
export interface HorizonSpec {
  interval: string;
  intervalMinutes: number;
  horizon: number;
}

export const HORIZONS: Record<Timeframe, HorizonSpec> = {
  "15m": { interval: "15m", intervalMinutes: 15, horizon: 1 },
  "30m": { interval: "30m", intervalMinutes: 30, horizon: 1 },
  "1h": { interval: "1h", intervalMinutes: 60, horizon: 1 },
  "4h": { interval: "1h", intervalMinutes: 60, horizon: 4 },
  "12h": { interval: "4h", intervalMinutes: 240, horizon: 3 },
  "24h": { interval: "4h", intervalMinutes: 240, horizon: 6 },
  "3d": { interval: "1d", intervalMinutes: 1440, horizon: 3 },
  "7d": { interval: "1d", intervalMinutes: 1440, horizon: 7 },
};

export const ALL_TIMEFRAMES = Object.keys(HORIZONS) as Timeframe[];

/** Bars of history a feature row needs (longest lookback + margin). */
export const FEATURE_LOOKBACK = 100;

/** Below this distance from 50% the model is treated as having no directional view. */
export const SIDEWAYS_BAND = 0.03;
