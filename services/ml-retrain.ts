/**
 * Retrain the price predictor (services/predictor) on fresh Binance history,
 * falling back to data/ohlcv CSV files when Binance is unreachable.
 */

import { MODELS_DIR } from "@/services/predictor";
import { trainAll } from "@/services/predictor/training-run";

export interface MlRetrainResult {
  ok: boolean;
  samples: number;
  outputPath: string;
  weightsPath?: string;
  error?: string;
}

export async function runMlRetrain(): Promise<MlRetrainResult> {
  try {
    let models = await trainAll({ source: "binance" });
    if (!models.length) models = await trainAll({ source: "csv" });
    if (!models.length) {
      return { ok: false, samples: 0, outputPath: MODELS_DIR, error: "no_training_data" };
    }
    return {
      ok: true,
      samples: models.reduce((s, m) => s + m.samples, 0),
      outputPath: MODELS_DIR,
      weightsPath: MODELS_DIR,
    };
  } catch (e) {
    return { ok: false, samples: 0, outputPath: MODELS_DIR, error: (e as Error).message };
  }
}
