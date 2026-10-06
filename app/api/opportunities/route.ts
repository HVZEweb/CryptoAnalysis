import { NextRequest, NextResponse } from "next/server";
import { getUserIdBySession } from "@/lib/auth";
import { getSessionToken } from "@/lib/request-context";
import { listOpportunities } from "@/services/opportunities/card";
import { getTelegramConfig, telegramFailing, telegramHealth } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** Every trade idea the Telegram bot sent, newest first, open ones marked to the current price. */
export async function GET(request: NextRequest) {
  if (!(await getUserIdBySession(getSessionToken(request)))) {
    return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
  }
  const h = telegramHealth();
  return NextResponse.json({
    ...(await listOpportunities()),
    // Lets the page warn when the bot cannot deliver (the opportunities are still logged and shown here).
    telegram: { connected: !!getTelegramConfig(), failing: telegramFailing(h), lastOkAt: h.lastOkAt, lastErrorAt: h.lastErrorAt, lastError: h.lastError },
  });
}
