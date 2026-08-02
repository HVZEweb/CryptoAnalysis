import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getNewsImpactEngine } from "@/services/news-impact/news-impact-engine";
import {
  getHistoryPerformance,
  getRecentHistory,
} from "@/services/news-impact/history";
import {
  getRecentAlerts,
  isAlertsEnabled,
  loadAlertsFromDisk,
  setAlertsEnabled,
} from "@/services/news-impact/alerts";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = await checkRateLimit(`news-impact:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit" }, { status: 429 });
  }

  try {
    const engine = await getNewsImpactEngine();
    const limit = Math.min(20, Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "10", 10) || 10));
    await loadAlertsFromDisk(20);
    const [recentHistory, historyPerformance] = await Promise.all([
      getRecentHistory(15),
      getHistoryPerformance(),
    ]);
    const state = engine.getState();

    return NextResponse.json({
      ...state,
      recentImpacts: state.recentImpacts.slice(0, limit),
      alertsEnabled: isAlertsEnabled(),
      recentAlerts: getRecentAlerts(15),
      recentHistory,
      historyPerformance,
    });
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message ?? "News impact failed" } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = await checkRateLimit(`news-impact-post:${ip}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit" }, { status: 429 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      enabled?: boolean;
    };
    const engine = await getNewsImpactEngine();

    if (body.action === "set_alerts") {
      await setAlertsEnabled(!!body.enabled);
      const state = engine.getState();
      return NextResponse.json({
        ok: true,
        alertsEnabled: isAlertsEnabled(),
        state: {
          ...state,
          alertsEnabled: isAlertsEnabled(),
        },
      });
    }

    if (body.action === "start") {
      const state = await engine.start();
      return NextResponse.json({ ok: true, state });
    }

    if (body.action === "stop") {
      const state = await engine.stop();
      return NextResponse.json({ ok: true, state });
    }

    const impacts = await engine.tick();
    return NextResponse.json({
      ok: true,
      newImpacts: impacts,
      state: engine.getState(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message ?? "News impact failed" } },
      { status: 500 }
    );
  }
}
