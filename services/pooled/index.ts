/**
 * Pooled model: one model per timeframe for ~30 liquid USDT perpetuals, trained on candles plus
 * futures positioning (services/pooled/features). It is trained weekly in GitHub Actions from the
 * Binance archive (scripts/train-pooled.ts) and published as a release; the server downloads it into
 * PREDICTOR_MODELS_DIR/pooled. Live, positioning comes from the market-data collector's tables.
 */

import fs from "fs";
import path from "path";
import type { Candle, Timeframe } from "@/types";
import { MODELS_DIR, predictWithModel, type PricePrediction, type PredictorModel } from "@/services/predictor";
import { computePooledFeatureSeries, POOLED_FEATURE_LABELS, POOLED_FEATURE_NAMES } from "@/services/pooled/features";
import type { DerivData } from "@/services/pooled/derivs";

/**
 * Coins the pooled model learns from and is validated on: liquid USDT perpetuals with long history.
 * Signals are only ever sent for these — a coin the model never saw has no measured result.
 */
export const POOLED_UNIVERSE = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT",
  "LINKUSDT", "DOTUSDT", "LTCUSDT", "BCHUSDT", "TRXUSDT", "NEARUSDT", "ATOMUSDT", "UNIUSDT",
  "ETCUSDT", "FILUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "INJUSDT", "SUIUSDT", "AAVEUSDT",
  "TIAUSDT", "SEIUSDT", "LDOUSDT", "XLMUSDT", "HBARUSDT", "WLDUSDT",
];

/** Timeframes the pooled model is trained for: shorter ones lose their edge to fees, longer have none. */
export const POOLED_TIMEFRAMES: Timeframe[] = ["1h", "4h"];

export const POOLED_DIR = path.join(MODELS_DIR, "pooled");

const cache = new Map<string, { mtimeMs: number; model: PredictorModel }>();

export function loadPooledModel(timeframe: Timeframe, dir = POOLED_DIR): PredictorModel | null {
  const file = path.join(dir, `${timeframe}.json`);
  try {
    const { mtimeMs } = fs.statSync(file);
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.model;
    const model = JSON.parse(fs.readFileSync(file, "utf-8")) as PredictorModel;
    if (model.version !== 2 || model.featureSet !== "pooled" || model.featureNames.join() !== POOLED_FEATURE_NAMES.join()) return null;
    cache.set(file, { mtimeMs, model });
    return model;
  } catch {
    return null;
  }
}

export function savePooledModel(model: PredictorModel, dir = POOLED_DIR): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${model.timeframe}.json`);
  fs.writeFileSync(file, JSON.stringify(model) + "\n");
  return file;
}

/** Same inference as the candle model, with the pooled feature rows. */
export function predictPooled(model: PredictorModel, candles: Candle[], price: number, btc: Candle[] | undefined, derivs: DerivData): PricePrediction | null {
  const features = computePooledFeatureSeries(candles, { btc, derivs });
  return predictWithModel(model, candles, price, {}, features, POOLED_FEATURE_LABELS);
}

/** Latest positioning from the collector's tables, oldest first. */
export async function loadDerivsFromDb(symbol: string, since: number): Promise<DerivData> {
  const { query } = await import("@/lib/db");
  const rows = await query<Array<{ ts: number; oi: number | null; g: number | null; t: number | null; k: number | null }>>(
    `SELECT ts, open_interest AS oi, global_ls_ratio AS g, top_ls_position_ratio AS t, taker_buy_sell_ratio AS k
       FROM market_metrics_5m WHERE symbol = ? AND ts >= ? ORDER BY ts`,
    [symbol, since]
  );
  const funding = await query<Array<{ funding_time: number; rate: number }>>(
    "SELECT funding_time, rate FROM funding_rates WHERE symbol = ? AND funding_time >= ? ORDER BY funding_time",
    [symbol, since - 3 * 86_400_000]
  );
  const n = (v: number | null) => (v == null ? undefined : Number(v));
  return {
    points: rows.map((r) => ({ ts: Number(r.ts), oi: n(r.oi), lsGlobal: n(r.g), lsTop: n(r.t), taker: n(r.k) })),
    funding: funding.map((f) => ({ time: Number(f.funding_time), rate: Number(f.rate) })),
  };
}
