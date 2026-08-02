import { describe, expect, it } from "vitest";
import { OKXPaperEngine } from "@/lib/okx-paper";

describe("OKXPaperEngine", () => {
  it("fills buy when market drops to limit", () => {
    const engine = new OKXPaperEngine(1000);
    const result = engine.placeLimitOrder({
      instId: "BTC-USDT",
      side: "buy",
      price: "100",
      size: "0.01",
    });

    const filled = engine.matchAgainstMarket({ bestBid: 99, bestAsk: 100, last: 99.5 });
    expect(filled).toContain(result.ordId);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it("records profitable round-trip", () => {
    const engine = new OKXPaperEngine(1000, 0.08);
    engine.placeLimitOrder({ instId: "BTC-USDT", side: "buy", price: "100", size: "0.1" });
    engine.matchAgainstMarket({ bestBid: 99, bestAsk: 100, last: 100 });

    engine.placeLimitOrder({ instId: "BTC-USDT", side: "sell", price: "101", size: "0.1" });
    engine.matchAgainstMarket({ bestBid: 101, bestAsk: 102, last: 101 });

    const stats = engine.getStats();
    expect(stats.totalTrades).toBe(1);
    expect(stats.netProfit).toBeGreaterThan(0);
  });

  it("forceFillNearestEntry for spike test", () => {
    const engine = new OKXPaperEngine(1000);
    engine.placeLimitOrder({ instId: "BTC-USDT", side: "buy", price: "50000", size: "0.001" });
    const ok = engine.forceFillNearestEntry(
      { bestBid: 50100, bestAsk: 50110, last: 50105 },
      "long"
    );
    expect(ok).toBe(true);
    expect(engine.hasOpenPosition()).toBe(true);
  });
});
