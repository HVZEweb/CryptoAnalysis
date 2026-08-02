/**
 * Optional Python ML backend (LightGBM / logistic fallback via scripts/ml-predict.py).
 */

import fs from "fs";
import { spawn } from "child_process";
import path from "path";
import type { MlFeatureVector } from "@/services/ml-features";
import type { MlPrediction, PredictionDirection } from "@/types";

const SCRIPT = path.join(process.cwd(), "scripts", "ml-predict.py");
const PYTHON_TIMEOUT_MS = 15_000;

const LOGISTIC_WEIGHTS: Record<string, number> = {
  rsi_norm: -0.35,
  macd_hist_norm: 0.55,
  ema_trend: 0.85,
  bb_position: 0.4,
  adx_norm: 0.3,
  stoch_rsi_norm: -0.25,
  cci_norm: 0.2,
  vwap_dev: 0.45,
  obv_trend: 0.5,
  structure_trend: 0.9,
  volume_anomaly: 0.35,
  volatility_norm: -0.15,
  fear_greed_norm: 0.25,
  btc_dom_change: -0.1,
  market_cap_chg: 0.15,
  news_sentiment: 0.3,
  funding_norm: -0.4,
  oi_change_proxy: 0.1,
  long_short_bias: 0.35,
  momentum_5: 0.7,
  momentum_20: 0.55,
  higher_tf_rsi: 0.4,
  ichimoku_cloud: 0.65,
  regime_score: 0.7,
  oi_change_norm: 0.25,
  funding_trend_norm: -0.3,
  cvd_norm: 0.55,
  delta_imbalance: 0.6,
  liq_proximity: -0.2,
};

export function computeFeatureImportance(
  features: MlFeatureVector,
  topN = 8
): Array<{ feature: string; contribution: number }> {
  const ranked = Object.entries(features.values)
    .map(([feature, value]) => ({
      feature,
      contribution: Math.abs((value ?? 0) * (LOGISTIC_WEIGHTS[feature] ?? 0)),
    }))
    .filter((x) => x.contribution > 0.01)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, topN);
  return ranked;
}

export interface MlRunResult {
  prediction: MlPrediction | null;
  /** True if any ML score was produced (python or TS fallback) */
  ok: boolean;
  error?: string;
  /** Top weighted features driving the score */
  featureImportance?: Array<{ feature: string; contribution: number }>;
}

function getPythonCmd(): string {
  if (process.env.PREDICTOR_PYTHON) return process.env.PREDICTOR_PYTHON;
  const win = path.join(process.cwd(), "bot", ".venv", "Scripts", "python.exe");
  const unix = path.join(process.cwd(), "bot", ".venv", "bin", "python");
  if (fs.existsSync(win)) return win;
  if (fs.existsSync(unix)) return unix;
  return "python";
}

function getModelPath(): string | undefined {
  const p = process.env.PREDICTOR_ML_MODEL_PATH?.trim();
  if (!p) return undefined;
  return fs.existsSync(p) ? p : undefined;
}

interface PythonMlResponse {
  direction: PredictionDirection;
  probability: number;
  probabilityUp: number;
  probabilityDown: number;
  model: string;
  rawLogit?: number;
  error?: string;
}

function mapPythonResponse(parsed: PythonMlResponse, features: MlFeatureVector): MlPrediction {
  return {
    direction: parsed.direction,
    probability: parsed.probability,
    probabilityUp: parsed.probabilityUp,
    probabilityDown: parsed.probabilityDown,
    model: parsed.model,
    confidence: Math.abs(parsed.probabilityUp - 50) * 2,
    keyFeatures: features.labels.slice(0, 6),
    source: "python",
  };
}

/**
 * TypeScript logistic regression — same weights as scripts/ml-predict.py.
 */
export function scoreMlFeaturesLocal(
  features: MlFeatureVector,
  fallbackReason?: string
): MlPrediction {
  let logit = 0;
  for (const [k, w] of Object.entries(LOGISTIC_WEIGHTS)) {
    logit += (features.values[k] ?? 0) * w;
  }
  const pUp = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, logit))));
  const pDown = 1 - pUp;

  let direction: PredictionDirection = "SIDEWAYS";
  let probability = 50;
  if (Math.abs(pUp - 0.5) >= 0.08) {
    if (pUp >= 0.5) {
      direction = "LONG";
      probability = Math.round(pUp * 1000) / 10;
    } else {
      direction = "SHORT";
      probability = Math.round(pDown * 1000) / 10;
    }
  }

  return {
    direction,
    probability,
    probabilityUp: Math.round(pUp * 1000) / 10,
    probabilityDown: Math.round(pDown * 1000) / 10,
    model: fallbackReason ? "ts_logistic_fallback" : "ts_logistic",
    confidence: Math.abs(pUp - 0.5) * 200,
    keyFeatures: features.labels.slice(0, 6),
    source: "typescript",
    fallbackReason,
  };
}

export function scoreMlFeaturesPython(
  features: MlFeatureVector,
  options: { timeoutMs?: number } = {}
): Promise<MlPrediction | null> {
  const timeoutMs = options.timeoutMs ?? PYTHON_TIMEOUT_MS;
  const modelPath = getModelPath();

  return new Promise((resolve) => {
    const python = getPythonCmd();
    const args = [SCRIPT];
    const child = spawn(python, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        ...(modelPath ? { PREDICTOR_ML_MODEL_PATH: modelPath } : {}),
      },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: MlPrediction | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      console.warn("[ml-backend] python timeout after", timeoutMs, "ms");
      finish(null);
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      console.warn("[ml-backend] spawn error:", err.message);
      finish(null);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.warn("[ml-backend] python exit", code, stderr.slice(0, 300));
        finish(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as PythonMlResponse;
        if (parsed.error) {
          console.warn("[ml-backend] python error:", parsed.error);
          finish(null);
          return;
        }
        finish(mapPythonResponse(parsed, features));
      } catch (e) {
        console.warn("[ml-backend] invalid JSON:", (e as Error).message);
        finish(null);
      }
    });

    try {
      child.stdin.write(
        JSON.stringify({
          features: features.values,
          modelPath: modelPath ?? null,
        })
      );
      child.stdin.end();
    } catch {
      finish(null);
    }
  });
}

/**
 * Run ML scorer: Python (with timeout + optional model file) → TS logistic fallback.
 * Never throws — returns ok:false only on catastrophic failure.
 */
export async function runMlModel(features: MlFeatureVector): Promise<MlRunResult> {
  try {
    const py = await scoreMlFeaturesPython(features);
    if (py) {
      return {
        prediction: {
          ...py,
          keyFeatures: computeFeatureImportance(features).map((f) => f.feature),
        },
        ok: true,
        featureImportance: computeFeatureImportance(features),
      };
    }

    const reason = getModelPath()
      ? "python_failed_or_timeout_with_model"
      : "python_failed_or_timeout";
    const local = scoreMlFeaturesLocal(features, reason);
    return {
      prediction: {
        ...local,
        keyFeatures: computeFeatureImportance(features).map((f) => f.feature),
      },
      ok: true,
      error: reason,
      featureImportance: computeFeatureImportance(features),
    };
  } catch (err) {
    console.error("[ml-backend] unexpected error:", err);
    try {
      return {
        prediction: scoreMlFeaturesLocal(features, "ml_subsystem_error"),
        ok: true,
        error: "ml_subsystem_error",
      };
    } catch {
      return { prediction: null, ok: false, error: "ml_total_failure" };
    }
  }
}
