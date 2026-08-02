import { query } from "@/lib/db";
import { TIMEFRAME_DURATION_MS } from "@/lib/accuracy";
import type { PredictionDirection, PredictionResult } from "@/types";

export interface ActivePredictionContext {
  id: string;
  symbol: string;
  direction: PredictionDirection;
  probability: number;
  timeframe: string;
  createdAt: string;
  ensembleScore?: number;
  marketRegime?: string;
  metaTrustScore?: number;
}

export type ImpactOnExisting = "confirms" | "contradicts" | "neutral" | "none";

export async function getActivePredictionForCoin(symbol: string): Promise<ActivePredictionContext | null> {
  const rows = await query<
    Array<{
      id: string;
      symbol: string;
      direction: string;
      probability: number;
      timeframe: string;
      payload: string;
      created_at: Date;
    }>
  >(
    `SELECT id, symbol, direction, probability, timeframe, payload, created_at
     FROM predictions
     WHERE symbol = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [symbol.toUpperCase()]
  );

  const row = rows[0];
  if (!row) return null;

  const createdAt = row.created_at.toISOString();
  const horizonMs = TIMEFRAME_DURATION_MS[row.timeframe] ?? TIMEFRAME_DURATION_MS["24h"];
  const ageMs = Date.now() - row.created_at.getTime();
  if (ageMs > horizonMs * 1.25) return null;

  let payload: Partial<PredictionResult> = {};
  try {
    payload = JSON.parse(row.payload) as Partial<PredictionResult>;
  } catch {
    // use row fields only
  }

  return {
    id: row.id,
    symbol: row.symbol,
    direction: row.direction as PredictionDirection,
    probability: row.probability,
    timeframe: row.timeframe,
    createdAt,
    ensembleScore: payload.ensembleScore,
    marketRegime: payload.analysis?.marketRegime?.regime ?? payload.ensembleBreakdown?.finalDirection,
    metaTrustScore: payload.metaTrustScore,
  };
}

export function resolveImpactOnExisting(
  newsDirection: PredictionDirection,
  active: ActivePredictionContext | null
): ImpactOnExisting {
  if (!active) return "none";
  if (newsDirection === "SIDEWAYS" || active.direction === "SIDEWAYS") return "neutral";
  if (newsDirection === active.direction) return "confirms";
  return "contradicts";
}

export function biasAlignmentBoost(
  newsDirection: PredictionDirection,
  active: ActivePredictionContext | null
): number {
  const relation = resolveImpactOnExisting(newsDirection, active);
  if (relation === "confirms") return 10;
  if (relation === "contradicts") return -6;
  return 0;
}
