import { describe, expect, it } from "vitest";
import { computeBacktestMetrics } from "@/lib/backtesting/metrics";
import type { BacktestTrade } from "@/lib/backtesting/types";

function mockTrade(overrides: Partial<BacktestTrade> = {}): BacktestTrade {
  return {
    timestamp: Date.now(),
    timeframe: "4h",
    regime: "Strong Bull",
    direction: "LONG",
    probability: 60,
    confidence: "Medium",
    ensembleScore: 0.2,
    entryPrice: 100,
    exitPrice: 101,
    returnPct: 1,
    won: true,
    llmCorrect: true,
    mlCorrect: true,
    rulesCorrect: true,
    ...overrides,
  };
}

describe("computeBacktestMetrics", () => {
  it("computes win rate and sharpe", () => {
    const trades = [
      mockTrade({ returnPct: 1, won: true }),
      mockTrade({ returnPct: -0.5, won: false, direction: "SHORT" }),
      mockTrade({ returnPct: 0.8, won: true }),
    ];
    const m = computeBacktestMetrics(trades, "4h");
    expect(m.totalTrades).toBe(3);
    expect(m.winRate).toBeCloseTo(2 / 3, 2);
    expect(m.profitFactor).toBeGreaterThan(0);
  });
});
