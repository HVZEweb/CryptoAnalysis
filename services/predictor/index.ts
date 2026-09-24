/**
 * Price predictor — the single place that turns candles into a direction probability
 * and a price forecast. Models are trained by `npm run predictor:train` and stored
 * as JSON in models/predictor/<timeframe>.json together with their validation report.
 */

import fs from "fs";
import path from "path";
import type { AnalysisContext, Candle, MlPrediction, PredictionDirection, PriceForecast, Timeframe } from "@/types";
import { HORIZONS, SIDEWAYS_BAND } from "@/services/predictor/config";
import { computeFeatureSeries, FEATURE_LABELS, FEATURE_NAMES } from "@/services/predictor/features";
import { featureContributions, predictProbability } from "@/services/predictor/model";
import type { PredictorModel } from "@/services/predictor/train";

export type { PredictorModel, ValidationReport } from "@/services/predictor/train";

export const MODELS_DIR = path.join(process.cwd(), "models", "predictor");

export function modelPath(timeframe: Timeframe, dir = MODELS_DIR): string {
  return path.join(dir, `${timeframe}.json`);
}

const modelCache = new Map<string, { mtimeMs: number; model: PredictorModel }>();

export function loadModel(timeframe: Timeframe, dir = MODELS_DIR): PredictorModel | null {
  const file = modelPath(timeframe, dir);
  try {
    const { mtimeMs } = fs.statSync(file);
    const cached = modelCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.model;
    const model = JSON.parse(fs.readFileSync(file, "utf-8")) as PredictorModel;
    if (model.version !== 1 || model.featureNames.join() !== FEATURE_NAMES.join()) return null;
    modelCache.set(file, { mtimeMs, model });
    return model;
  } catch {
    return null;
  }
}

export function saveModel(model: PredictorModel, dir = MODELS_DIR): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = modelPath(model.timeframe, dir);
  fs.writeFileSync(file, JSON.stringify(model, null, 2) + "\n");
  return file;
}

export interface PricePrediction {
  /** Direction view; null when the model has not shown an edge in validation */
  ml: MlPrediction | null;
  priceForecast: PriceForecast;
  probabilityUp: number;
  model: PredictorModel;
  topFeatures: Array<{ feature: string; label: string; contribution: number }>;
}

/**
 * Pure inference: `candles` are bars of `model.interval`, oldest first.
 * The still-forming last bar must already be removed by the caller.
 */
export function predictWithModel(model: PredictorModel, candles: Candle[], price: number): PricePrediction | null {
  const { rows, vol } = computeFeatureSeries(candles);
  const i = rows.length - 1;
  const x = rows[i];
  if (!x || !(vol[i] > 0) || !(price > 0)) return null;

  const pUp = predictProbability(model.logistic, x);
  const unit = vol[i] * Math.sqrt(model.horizon);
  const at = (z: number) => price * Math.exp(z * unit);
  const q = model.quantiles;
  const expectedZ = model.expectedMove.intercept + model.expectedMove.slope * (pUp - 0.5);
  const predictedPrice = at(expectedZ);

  const priceForecast: PriceForecast = {
    predictedPrice,
    predictedHigh: at(q.high.q90),
    predictedLow: at(q.low.q10),
    confidenceBand: { low: at(q.close.q10), high: at(q.close.q90) },
    expectedMovePct: ((predictedPrice - price) / price) * 100,
    source: "predictor",
  };

  const topFeatures = featureContributions(model.logistic, x, model.featureNames)
    .slice(0, 5)
    .map((f) => ({
      ...f,
      label: FEATURE_LABELS[f.feature as keyof typeof FEATURE_LABELS] ?? f.feature,
    }));

  const v = model.validation;
  let ml: MlPrediction | null = null;
  if (v.hasEdge) {
    let direction: PredictionDirection = "SIDEWAYS";
    if (pUp - 0.5 >= SIDEWAYS_BAND) direction = "LONG";
    else if (0.5 - pUp >= SIDEWAYS_BAND) direction = "SHORT";
    const round = (n: number) => Math.round(n * 1000) / 10;
    ml = {
      direction,
      probability: direction === "SHORT" ? round(1 - pUp) : direction === "LONG" ? round(pUp) : 50,
      probabilityUp: round(pUp),
      probabilityDown: round(1 - pUp),
      model: `predictor_${model.timeframe}`,
      confidence: Math.min(100, Math.abs(pUp - 0.5) * 200),
      keyFeatures: topFeatures.map((f) => `${f.label} ${f.contribution > 0 ? "↑" : "↓"}`),
      source: "predictor",
      validationAccuracy: round(v.accuracy),
    };
  }

  return { ml, priceForecast, probabilityUp: pUp, model, topFeatures };
}

function closedCandles(candles: Candle[], now = Date.now()): Candle[] {
  return candles.filter((c) => c.closeTime < now);
}

export interface PredictorRunResult {
  result: PricePrediction | null;
  error?: string;
}

/** Runs the trained model for the request's timeframe on the candles already fetched for analysis. */
export function runPricePredictor(ctx: Pick<AnalysisContext, "timeframe" | "candles" | "marketData">): PredictorRunResult {
  const model = loadModel(ctx.timeframe);
  if (!model) return { result: null, error: "model_not_trained" };

  const candles = closedCandles(ctx.candles[HORIZONS[ctx.timeframe].interval] ?? []);
  const result = predictWithModel(model, candles, ctx.marketData.price);
  if (!result) return { result: null, error: "not_enough_candles" };
  if (!result.ml) return { result, error: "model_has_no_edge" };
  return { result };
}
