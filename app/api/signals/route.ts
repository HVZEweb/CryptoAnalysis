import { NextRequest, NextResponse } from "next/server";
import { getUserIdBySession } from "@/lib/auth";
import { getSessionToken } from "@/lib/request-context";
import { closedSignals, openSignals } from "@/services/signals/store";
import { trackRecord } from "@/services/signals/logic";

export const dynamic = "force-dynamic";

/** Live track record of the Telegram signals: every signal sent, its real result after costs. */
export async function GET(request: NextRequest) {
  if (!(await getUserIdBySession(getSessionToken(request)))) {
    return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
  }
  const [closed, open] = await Promise.all([closedSignals(), openSignals()]);
  const record = trackRecord(closed);
  const demoClosed = closed.filter((s) => s.demo_status === "closed");
  const demo = demoClosed.length ? trackRecord(demoClosed.map((s) => ({ net_bp: s.demo_net_bp ?? 0 }))) : null;

  let equity = 0;
  const curve = closed
    .filter((s) => s.closed_at != null)
    .sort((a, b) => a.closed_at! - b.closed_at!)
    .map((s) => {
      equity += (s.net_bp ?? 0) / 100;
      return { t: s.closed_at!, pct: Math.round(equity * 100) / 100 };
    });

  const row = (s: (typeof closed)[number]) => ({
    id: s.id,
    symbol: s.symbol,
    timeframe: s.timeframe,
    model: s.model_key.startsWith("pooled:") ? "общая" : "по свечам",
    side: s.side,
    entry: s.entry,
    tp: s.tp,
    sl: s.sl,
    sentAt: s.sent_at,
    closeBy: s.close_by,
    status: s.status,
    exitPrice: s.exit_price,
    netBp: s.net_bp,
    closedAt: s.closed_at,
    demoStatus: s.demo_status ?? null,
    demoNetBp: s.demo_net_bp ?? null,
  });

  return NextResponse.json({
    record,
    demo,
    curve,
    open: open.map(row),
    recent: closed.slice(-100).reverse().map(row),
  });
}
