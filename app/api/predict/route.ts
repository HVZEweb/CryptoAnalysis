import { NextRequest, NextResponse } from "next/server";
import { resolveCoinBySymbol } from "@/lib/coins";
import { enforcePredictionAccess, releaseReservedQuota } from "@/lib/predict-guard";
import { savePrediction } from "@/lib/predictions-db";
import { getModelConfidence, recordLivePrediction } from "@/lib/monitoring/prediction-monitor";
import { predictionFormSchema } from "@/lib/schemas";
import { PIPELINE_STEP_LABELS } from "@/lib/progress";
import { runPredictionPipeline } from "@/services/prediction";

export const maxDuration = 120;

function errorStatus(code?: string): number {
  if (code === "RATE_LIMIT") return 429;
  if (code === "QUOTA_EXCEEDED") return 402;
  if (code === "VALIDATION_ERROR") return 400;
  if (code === "NO_INTERNET") return 503;
  return 500;
}

export async function POST(request: NextRequest) {
  const access = await enforcePredictionAccess(request);
  if (!access.ok) {
    return NextResponse.json(
      { error: { code: access.code, message: access.message } },
      { status: access.status }
    );
  }

  try {
    const body: unknown = await request.json();
    const parsed = predictionFormSchema.safeParse(body);

    if (!parsed.success) {
      await releaseReservedQuota(access.identity);
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Неверные данные формы." } },
        { status: 400 }
      );
    }

    const coin = await resolveCoinBySymbol(parsed.data.coinSymbol);
    const prediction = await runPredictionPipeline(
      coin,
      parsed.data.market,
      parsed.data.timeframe,
      undefined,
      parsed.data.model
    );
    const id = await savePrediction(prediction, access.identity.userId, access.identity.deviceId);
    await recordLivePrediction(id, prediction).catch(() => undefined);
    const modelConfidence = await getModelConfidence().catch(() => undefined);

    return NextResponse.json({ prediction: { ...prediction, modelConfidence } });
  } catch (error) {
    await releaseReservedQuota(access.identity);
    const err = error as { code?: string; message?: string };
    return NextResponse.json(
      { error: { code: err.code ?? "UNKNOWN", message: err.message ?? "Ошибка генерации прогноза" } },
      { status: errorStatus(err.code) }
    );
  }
}

export async function GET() {
  return NextResponse.json({ steps: PIPELINE_STEP_LABELS });
}
