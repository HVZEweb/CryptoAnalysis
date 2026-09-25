/**
 * Models are no longer trained on the server: GitHub Actions trains them weekly from the Binance
 * archive (.github/workflows/train-models.yml) and the server downloads the release daily.
 * Training inside the site's process would take up to 1 GB on a 1.9 GB server shared with other
 * services, so the retrain buttons explain where training happens instead of starting it.
 *
 * Locally (development) `npm run predictor:train` still trains in place.
 */

import { MODELS_DIR } from "@/services/predictor";

export interface MlRetrainResult {
  ok: boolean;
  samples: number;
  outputPath: string;
  weightsPath?: string;
  error?: string;
}

export const RETRAIN_ELSEWHERE =
  "Модели обучаются в GitHub Actions (Actions → Train models) каждую субботу; сервер забирает их каждый день в 06:00. " +
  "Запустить обучение раньше можно там же кнопкой «Run workflow».";

export async function runMlRetrain(): Promise<MlRetrainResult> {
  return { ok: false, samples: 0, outputPath: MODELS_DIR, error: RETRAIN_ELSEWHERE };
}
