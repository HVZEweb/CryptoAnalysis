import { NextRequest, NextResponse } from "next/server";
import { accessOf } from "@/lib/access";
import { listOpportunities } from "@/services/opportunities/card";
import { getTelegramConfig, telegramFailing, telegramHealth } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Every trade idea the bot sent, newest first, open ones marked to the current price. Without a
 * subscription only closed ones are listed: the track record is public, live ideas are paid.
 */
export async function GET(request: NextRequest) {
  const { user, paid, admin } = await accessOf(request);
  if (!user) return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
  const list = await listOpportunities();
  const h = telegramHealth();
  return NextResponse.json({
    ...list,
    items: paid ? list.items : list.items.filter((o) => o.status !== "open"),
    locked: !paid,
    lockedOpen: paid ? 0 : list.items.filter((o) => o.status === "open").length,
    // The delivery warning concerns the owner's bot: admins only.
    telegram: admin ? { connected: !!getTelegramConfig(), failing: telegramFailing(h), lastOkAt: h.lastOkAt, lastErrorAt: h.lastErrorAt, lastError: h.lastError } : undefined,
  });
}
