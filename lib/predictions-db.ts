import { randomBytes } from "crypto";
import { execute, query } from "@/lib/db";
import type { PredictionResult } from "@/types";

export async function savePrediction(
  prediction: PredictionResult,
  userId?: string,
  deviceId?: string
): Promise<string> {
  const id = randomBytes(12).toString("hex");
  const levels = prediction.tradeLevels;

  await execute(
    `INSERT INTO predictions (
      id, user_id, device_id, symbol, coin_name, market, timeframe, direction, probability,
      price_at_prediction, price_range_low, price_range_high,
      entry_price, tp_price, sl_price, exit_price, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId ?? null,
      deviceId ?? null,
      prediction.symbol,
      prediction.coin,
      prediction.market,
      prediction.timeframe,
      prediction.direction,
      prediction.probability,
      prediction.priceAtPrediction,
      prediction.priceRange.low,
      prediction.priceRange.high,
      levels?.entry ?? null,
      levels?.tp ?? null,
      levels?.sl ?? null,
      levels?.exit ?? null,
      JSON.stringify(prediction),
    ]
  );

  return id;
}

export async function getPredictionsForUser(userId: string, limit = 20) {
  const rows = await query<Array<{ payload: string; created_at: Date }>>(
    "SELECT payload, created_at FROM predictions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    [userId, limit]
  );
  return rows.map((r) => {
    try {
      const p = JSON.parse(r.payload) as PredictionResult;
      return { ...p, createdAt: p.createdAt ?? r.created_at.toISOString() };
    } catch {
      return null;
    }
  }).filter((p): p is PredictionResult & { createdAt: string } => p !== null);
}

export async function deletePredictionsForUser(userId: string): Promise<number> {
  const result = await execute("DELETE FROM predictions WHERE user_id = ?", [userId]);
  return result.affectedRows;
}
