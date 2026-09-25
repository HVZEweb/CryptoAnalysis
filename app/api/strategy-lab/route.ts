import { NextResponse } from "next/server";
import { denyUnlessAdmin } from "@/lib/admin-auth";
import { ALL_TIMEFRAMES } from "@/services/predictor/config";
import { loadModel } from "@/services/predictor";

export const dynamic = "force-dynamic";

/** Strategy-lab verdict of every trained model: which timeframes have a setup that pays after fees. */
export async function GET(request: Request) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;

  const timeframes = ALL_TIMEFRAMES.map((timeframe) => {
    const model = loadModel(timeframe);
    return {
      timeframe,
      trained: Boolean(model),
      interval: model?.interval,
      trainedAt: model?.trainedAt,
      symbols: model?.symbols ?? [],
      strategy: model?.strategy ?? null,
    };
  });
  return NextResponse.json({ timeframes });
}
