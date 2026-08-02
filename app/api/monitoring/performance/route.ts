import { NextRequest, NextResponse } from "next/server";
import { getPerformanceSnapshot } from "@/lib/monitoring/prediction-monitor";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = await checkRateLimit(`monitoring:${ip}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit" }, { status: 429 });
  }

  const refresh = request.nextUrl.searchParams.get("refresh") === "true";

  try {
    const snapshot = await getPerformanceSnapshot({ refresh, syncRegime: refresh });
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message ?? "Monitoring failed" } },
      { status: 500 }
    );
  }
}
