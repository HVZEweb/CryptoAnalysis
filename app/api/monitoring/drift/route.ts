import { NextRequest, NextResponse } from "next/server";
import { getDriftReport } from "@/lib/monitoring/prediction-monitor";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = await checkRateLimit(`monitoring:${ip}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit" }, { status: 429 });
  }

  try {
    const report = await getDriftReport();
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message ?? "Drift check failed" } },
      { status: 500 }
    );
  }
}
