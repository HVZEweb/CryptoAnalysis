import { describe, expect, it } from "vitest";
import { chartWindow, liveState, marketOf } from "@/services/opportunities/card";
import { cardLine } from "@/services/signals/chance";

const MIN = 60_000;

describe("opportunity cards", () => {
  it("marks an open trade to the price: result after a market exit, progress towards target or stop", () => {
    const long = { side: "LONG" as const, entry: 100, tp: 102, sl: 98 };
    const up = liveState(long, 101);
    expect(up.progress).toBeCloseTo(0.5);
    expect(up.netBp).toBeCloseTo(100 - 16); // +1% minus market entry and exit with slippage
    expect(liveState(long, 97).progress).toBe(-1);
    expect(liveState({ side: "SHORT", entry: 100, tp: 98, sl: 102 }, 99).progress).toBeCloseTo(0.5);
  });

  it("charts some history before the entry and the whole trade, in a bar size that keeps the chart readable", () => {
    const entry = Date.UTC(2026, 9, 1, 12);
    const hour = chartWindow({ entry_time: entry, close_by: entry + 60 * MIN, closed_at: null }, entry + 10 * 60 * MIN);
    expect(hour.from).toBe(entry - 90 * MIN);
    expect(hour.interval).toBe("1m");
    const day = chartWindow({ entry_time: entry, close_by: entry + 24 * 60 * MIN, closed_at: entry + 3 * 60 * MIN }, entry + 72 * 60 * MIN);
    expect(day.interval).toBe("1h"); // 36 h before + 24 h trade + 12 h after = 72 bars
    // An open trade is charted up to now, not into the future.
    const open = chartWindow({ entry_time: entry, close_by: entry + 4 * 60 * MIN, closed_at: null }, entry + 30 * MIN);
    expect(open.to).toBe(entry + 30 * MIN);
  });

  it("prices news and pooled ideas on the perpetual, candle models on spot", () => {
    expect(marketOf({ kind: "news", model_key: "news" })).toBe("Futures");
    expect(marketOf({ kind: "chance", model_key: "pooled:1h" })).toBe("Futures");
    expect(marketOf({ kind: "chance", model_key: "candles:1h" })).toBe("Spot");
  });

  it("links Telegram messages to the card only when the site address is known", () => {
    const before = process.env.SITE_URL;
    delete process.env.SITE_URL;
    expect(cardLine(7)).toBeNull();
    process.env.SITE_URL = "https://example.test:8443/";
    expect(cardLine(7)).toContain("https://example.test:8443/opportunities/7");
    if (before === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = before;
  });
});
