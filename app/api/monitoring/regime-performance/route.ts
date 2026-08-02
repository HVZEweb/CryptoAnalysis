import { NextRequest, NextResponse } from "next/server";
import { getLiveRegimePerformance } from "@/lib/monitoring/prediction-monitor";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = await checkRateLimit(`monitoring:${ip}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit" }, { status: 429 });
  }

  try {
    const data = await getLiveRegimePerformance();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message ?? "Regime performance failed" } },
      { status: 500 }
    );
  }
}
