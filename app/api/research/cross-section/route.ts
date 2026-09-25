import { NextResponse } from "next/server";
import { denyUnlessAdmin } from "@/lib/admin-auth";
import { loadXsReport } from "@/services/cross-section/research";
import { runCrossSection } from "@/services/cross-section/run";

export const dynamic = "force-dynamic";

/** One run at a time; it downloads ~50 coins of daily candles and takes a minute or two. */
let running: { startedAt: string } | null = null;
let lastError: string | null = null;

export async function GET(request: Request) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;
  return NextResponse.json({ report: loadXsReport(), running, lastError });
}

export async function POST(request: Request) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;
  if (!running) {
    running = { startedAt: new Date().toISOString() };
    lastError = null;
    runCrossSection()
      .catch((e: Error) => {
        lastError = e.message ?? String(e);
      })
      .finally(() => {
        running = null;
      });
  }
  return NextResponse.json({ running }, { status: 202 });
}
