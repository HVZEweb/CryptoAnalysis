import { describe, expect, it } from "vitest";
import { aggregatePortfolio, simulateTrade } from "@/lib/portfolio-sim";

describe("simulateTrade", () => {
  it("LONG hits TP", () => {
    const result = simulateTrade(
      {
        symbol: "BTC",
        direction: "LONG",
        timeframe: "15m",
        entry: 100,
        tp: 105,
        sl: 98,
        candles: [{ openTime: 0, open: 100, high: 106, low: 99, close: 104, volume: 1, closeTime: 1, quoteVolume: 1, trades: 1 }],
        actualPrice: 104,
        completed: true,
      },
      1000
    );
    expect(result.exitReason).toBe("tp");
    expect(result.pnlPct).toBeGreaterThan(4);
  });

  it("SHORT hits SL", () => {
    const result = simulateTrade(
      {
        symbol: "BTC",
        direction: "SHORT",
        timeframe: "15m",
        entry: 100,
        tp: 95,
        sl: 102,
        candles: [{ openTime: 0, open: 100, high: 103, low: 99, close: 101, volume: 1, closeTime: 1, quoteVolume: 1, trades: 1 }],
        actualPrice: 101,
        completed: true,
      },
      1000
    );
    expect(result.exitReason).toBe("sl");
    expect(result.pnlPct).toBeLessThan(0);
  });
});

describe("aggregatePortfolio", () => {
  it("sums PnL across trades", () => {
    const trades = [
      {
        symbol: "BTC",
        direction: "LONG" as const,
        timeframe: "15m",
        status: "completed" as const,
        exitReason: "tp" as const,
        entry: 100,
        exitPrice: 105,
        pnlPct: 5,
        pnlUsd: 50,
      },
      {
        symbol: "ETH",
        direction: "SHORT" as const,
        timeframe: "1h",
        status: "completed" as const,
        exitReason: "time" as const,
        entry: 200,
        exitPrice: 198,
        pnlPct: 1,
        pnlUsd: 10,
      },
    ];
    const summary = aggregatePortfolio(trades, [80, 70], 1000);
    expect(summary.totalPnlUsd).toBe(60);
    expect(summary.wins).toBe(2);
    expect(summary.evaluatedTrades).toBe(2);
  });
});
