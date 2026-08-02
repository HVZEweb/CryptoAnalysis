import { NextRequest } from "next/server";
import { resolveCoinBySymbol } from "@/lib/coins";
import { enforcePredictionAccess, releaseReservedQuota } from "@/lib/predict-guard";
import { savePrediction } from "@/lib/predictions-db";
import { getModelConfidence, recordLivePrediction } from "@/lib/monitoring/prediction-monitor";
import { predictionFormSchema } from "@/lib/schemas";
import { runPredictionPipeline } from "@/services/prediction";
import { normalizeOpenRouterError } from "@/services/openrouter";

export const maxDuration = 300;

type PredictionAccess = Extract<
  Awaited<ReturnType<typeof enforcePredictionAccess>>,
  { ok: true }
>;

export async function POST(request: NextRequest) {
  let access: PredictionAccess;

  try {
    const result = await enforcePredictionAccess(request);
    if (!result.ok) {
      const payload = JSON.stringify({
        type: "error",
        error: { code: result.code, message: result.message },
      });
      return new Response(`data: ${payload}\n\n`, {
        status: result.status,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    access = result;
  } catch (error) {
    const payload = JSON.stringify({
      type: "error",
      error: {
        code: "UNKNOWN",
        message: error instanceof Error ? error.message : "Ошибка проверки доступа",
      },
    });
    return new Response(`data: ${payload}\n\n`, {
      status: 503,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const body: unknown = await request.json();
  const parsed = predictionFormSchema.safeParse(body);

  if (!parsed.success) {
    await releaseReservedQuota(access.identity);
    const payload = JSON.stringify({
      type: "error",
      error: { code: "VALIDATION_ERROR", message: "Неверные данные формы." },
    });
    return new Response(`data: ${payload}\n\n`, {
      status: 400,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        const coin = await resolveCoinBySymbol(parsed.data.coinSymbol);
        const model =
          parsed.data.model?.trim() && parsed.data.model !== "__default__"
            ? parsed.data.model.trim()
            : undefined;
        const prediction = await runPredictionPipeline(
          coin,
          parsed.data.market,
          parsed.data.timeframe,
          (event) => send({ type: "progress", ...event }),
          model
        );
        let modelConfidence;
        try {
          const id = await savePrediction(prediction, access.identity.userId, access.identity.deviceId);
          await recordLivePrediction(id, prediction).catch(() => undefined);
          modelConfidence = await getModelConfidence().catch(() => undefined);
        } catch (saveErr) {
          console.error("[predict/stream] savePrediction failed:", saveErr);
        }
        send({ type: "result", prediction: { ...prediction, modelConfidence } });
      } catch (error) {
        await releaseReservedQuota(access.identity);
        const err = normalizeOpenRouterError(error);
        send({
          type: "error",
          error: {
            code: err.code,
            message: err.message,
          },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function GET() {
  return Response.json({
    message: "Этот адрес принимает только POST (не открывайте его в браузере).",
    usage: {
      method: "POST",
      body: { coinSymbol: "BTC", market: "Futures", timeframe: "24h" },
    },
    diagnostics: "GET http://localhost:3000/api/status",
  });
}
