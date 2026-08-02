import { NextRequest, NextResponse } from "next/server";
import {
  getAlertsReport,
  processAndDispatchAlerts,
} from "@/lib/monitoring/alerts";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = await checkRateLimit(`monitoring-alerts:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit" }, { status: 429 });
  }

  const dispatch = request.nextUrl.searchParams.get("dispatch") === "true";

  try {
    if (dispatch) {
      const result = await processAndDispatchAlerts();
      return NextResponse.json({
        active: result.active,
        dispatched: result.dispatched,
        config: result.config,
      });
    }

    const report = await getAlertsReport();
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message ?? "Alerts failed" } },
      { status: 500 }
    );
  }
}
