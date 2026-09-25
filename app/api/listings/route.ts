import { NextRequest, NextResponse } from "next/server";
import { getUserIdBySession } from "@/lib/auth";
import { getSessionToken } from "@/lib/request-context";
import * as store from "@/services/listings/store";
import { studyFromHistory } from "@/services/listings/monitor";
import { listingMoves, variantLabel } from "@/services/listings/analysis";
import type { CoinProfile } from "@/services/listings/profile";

export const dynamic = "force-dynamic";

/** New coins on OKX: what usually happens after a listing, and the latest listings with their first moves. */
export async function GET(request: NextRequest) {
  if (!(await getUserIdBySession(getSessionToken(request)))) {
    return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
  }
  const study = await studyFromHistory();
  const recent = (await store.listings()).slice(0, 60);
  const bars = await store.barsOf(recent.map((r) => r.base));
  return NextResponse.json({
    study: { ...study, bestLabel: study.best ? variantLabel(study.best.variant) : null },
    recent: recent.map((r) => {
      const m = listingMoves(bars.get(r.base) ?? [], r.list_time);
      const p = r.profile as CoinProfile | null;
      return {
        base: r.base,
        listTime: r.list_time,
        markets: r.markets,
        live: r.source === "live",
        announcementUrl: r.announcement_url,
        entry: m?.entry ?? null,
        change4: m?.change[4] ?? null,
        change24: m?.change[24] ?? null,
        change168: m?.change[168] ?? null,
        maxUp24: m?.maxUp24 ?? null,
        maxDown24: m?.maxDown24 ?? null,
        onBinance: p ? Boolean(p.binanceSpot || p.binanceFutures) : null,
        marketCap: p?.coingecko?.marketCap ?? null,
      };
    }),
  });
}
