import { denyUnlessAdmin } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveCoinBySymbol } from "@/lib/coins";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { predictionFormSchema } from "@/lib/schemas";
import { ensemblePredictor } from "@/services/ensemble-prediction";
import { extractMlFeatures } from "@/services/ml-features";
import { buildAnalysisContext } from "@/services/prediction";
import { generatePrediction } from "@/services/ai-prediction";
import type { PredictionDirection } from "@/types";

export const maxDuration = 120;

const debugSchema = predictionFormSchema.extend({
  /** Skip OpenRouter — use mock LLM vote for fast ensemble inspection */
  useMockLlm: z.boolean().optional(),
  llmOverride: z
    .object({
      direction: z.enum(["LONG", "SHORT", "SIDEWAYS"]),
      probability: z.number().min(0).max(100),
    })
    .optional(),
});

function errorStatus(code?: string): number {
  if (code === "RATE_LIMIT") return 429;
  if (code === "VALIDATION_ERROR") return 400;
  if (code === "NO_INTERNET") return 503;
  if (code === "API_UNAVAILABLE") return 503;
  return 500;
}

function mockLlmVote(
  coin: { name: string; symbol: string },
  market: string,
  timeframe: string,
  override?: { direction: PredictionDirection; probability: number }
) {
  const direction = override?.direction ?? "SIDEWAYS";
  const probability = override?.probability ?? 55;
  const probabilityUp =
    direction === "LONG" ? probability : direction === "SHORT" ? 100 - probability : 50;
  return {
    coin: coin.name,
    symbol: coin.symbol,
    market: market as "Spot" | "Futures",
    timeframe: timeframe as import("@/types").Timeframe,
    direction,
    probability,
    probabilityUp,
    probabilityDown: 100 - probabilityUp,
    confidence: "Medium" as const,
    priceRange: { low: 0, high: 0 },
    reasons: ["[debug] mock LLM vote"],
    risks: [],
    keyFactors: [],
    recommendation: "[debug] ensemble inspection only",
    disclaimer: "Debug endpoint — not a trading signal.",
  };
}

export async function POST(request: NextRequest) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;

  const ip = getClientIp(request);
  const burst = await checkRateLimit(`predict-debug:${ip}`, 10, 60_000);
  if (!burst.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMIT",
          message: `Слишком частые запросы. Повторите через ${burst.retryAfterSec} сек.`,
        },
      },
      { status: 429 }
    );
  }

  try {
    const body: unknown = await request.json();
    const parsed = debugSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Неверные данные формы." } },
        { status: 400 }
      );
    }

    const coin = await resolveCoinBySymbol(parsed.data.coinSymbol);
    const { context, snapshot } = await buildAnalysisContext(
      coin,
      parsed.data.market,
      parsed.data.timeframe
    );

    const llmPrediction =
      parsed.data.useMockLlm || parsed.data.llmOverride
        ? mockLlmVote(coin, parsed.data.market, parsed.data.timeframe, parsed.data.llmOverride)
        : await generatePrediction(context, parsed.data.model);

    const mlFeatures = extractMlFeatures(context);
    const { prediction, breakdown } = await ensemblePredictor.combine(context, snapshot, llmPrediction);

    return NextResponse.json({
      debug: true,
      symbol: coin.symbol,
      market: parsed.data.market,
      timeframe: parsed.data.timeframe,
      llmSource: parsed.data.useMockLlm || parsed.data.llmOverride ? "mock" : "openrouter",
      mlFeatures: {
        labels: mlFeatures.labels,
        values: mlFeatures.values,
        ordered: mlFeatures.ordered,
      },
      ensembleBreakdown: breakdown,
      finalPrediction: {
        direction: prediction.direction,
        probability: prediction.probability,
        probabilityUp: prediction.probabilityUp,
        probabilityDown: prediction.probabilityDown,
        confidence: prediction.confidence,
        ensembleScore: prediction.ensembleScore,
      },
    });
  } catch (error) {
    const err = error as { code?: string; message?: string };
    return NextResponse.json(
      { error: { code: err.code ?? "UNKNOWN", message: err.message ?? "Ошибка ensemble debug" } },
      { status: errorStatus(err.code) }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/predict/ensemble/debug",
    method: "POST",
    description: "Full ensemble breakdown: LLM, ML, rules, weights, probabilities",
    body: {
      coinSymbol: "BTC",
      market: "Futures",
      timeframe: "4h",
      useMockLlm: true,
      llmOverride: { direction: "LONG", probability: 65 },
    },
    note: "Does not consume prediction quota. useMockLlm=true skips OpenRouter.",
  });
}
