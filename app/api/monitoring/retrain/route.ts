import { denyUnlessAdmin } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import {
  getRetrainStatus,
  runScheduledRetrain,
} from "@/lib/monitoring/retraining-scheduler";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function GET() {
  try {
    const status = await getRetrainStatus();
    return NextResponse.json({ status });
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message ?? "Status failed" } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;

  const ip = getClientIp(request);
  const rate = await checkRateLimit(`monitoring-retrain:${ip}`, 5, 300_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit" }, { status: 429 });
  }

  try {
    let force = false;
    try {
      const body = (await request.json()) as { force?: boolean };
      force = body.force === true;
    } catch {
      // empty body — automatic mode
    }

    const result = await runScheduledRetrain({
      force,
      trigger: force ? "forced" : undefined,
    });

    return NextResponse.json({
      ok: result.run.ok,
      skipped: result.skipped,
      run: result.run,
      decision: result.decision,
    });
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message ?? "Retrain failed" } },
      { status: 500 }
    );
  }
}
