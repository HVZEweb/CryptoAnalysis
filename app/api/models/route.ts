import { NextResponse } from "next/server";
import { ALL_TIMEFRAMES } from "@/services/predictor/config";
import { loadModel } from "@/services/predictor";

export const dynamic = "force-dynamic";

/** What the trained model of each timeframe can honestly offer: a direction, a validated trade, or only a price range. */
export async function GET() {
  const timeframes = ALL_TIMEFRAMES.map((timeframe) => {
    const m = loadModel(timeframe);
    return {
      timeframe,
      trained: Boolean(m),
      hasEdge: Boolean(m?.validation.hasEdge),
      accuracy: m ? Math.round(m.validation.accuracy * 1000) / 10 : null,
      tradeProfitable: Boolean(m?.strategy?.profitable),
      trainedAt: m?.trainedAt ?? null,
    };
  });
  return NextResponse.json({ timeframes });
}
