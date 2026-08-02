import { describe, expect, it } from "vitest";
import { computeBacktestMetrics } from "@/lib/backtesting/metrics";
import type { BacktestTrade } from "@/lib/backtesting/types";
import { evaluateMetaLearner, resolveDynamicWeights } from "@/services/ensemble-meta";
import type { EnsembleBreakdown } from "@/types";

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

describe("ensemble-meta", () => {
  it("lowers trust on divergent agreement", () => {
    const breakdown: EnsembleBreakdown = {
      weights: { llm: 0.5, ml: 0.35, rules: 0.15 },
      effectiveWeights: { llm: 0.5, ml: 0.35, rules: 0.15 },
      mlAvailable: true,
      llm: { direction: "LONG", probability: 70, score: 0.7 },
      ml: {
        direction: "SHORT",
        probability: 65,
        probabilityUp: 35,
        probabilityDown: 65,
        model: "test",
        confidence: 50,
        keyFeatures: [],
      },
      rules: [],
      rulesAggregateScore: 0,
      ensembleScore: 0.05,
      agreement: "divergent",
      finalDirection: "SIDEWAYS",
      finalProbability: 50,
    };

    const meta = evaluateMetaLearner(breakdown);
    expect(meta.trustScore).toBeLessThan(50);
    expect(meta.lowConfidence).toBe(true);
  });

  it("shifts weights in Low Conviction regime", () => {
    const w = resolveDynamicWeights(
      { regime: "Low Conviction", confidence: 75, score: 0, signals: [] },
      "partial"
    );
    expect(w.ml).toBeLessThan(0.35);
    expect(w.rules).toBeGreaterThan(0.15);
  });

  it("penalizes trust when LLM direction differs from final", () => {
    const breakdown: EnsembleBreakdown = {
      weights: { llm: 0.5, ml: 0.35, rules: 0.15 },
      effectiveWeights: { llm: 0.5, ml: 0.35, rules: 0.15 },
      mlAvailable: true,
      llm: { direction: "SIDEWAYS", probability: 52, score: 0 },
      ml: {
        direction: "LONG",
        probability: 70,
        probabilityUp: 70,
        probabilityDown: 30,
        model: "test",
        confidence: 50,
        keyFeatures: [],
      },
      rules: [],
      rulesAggregateScore: 0.2,
      ensembleScore: 0.41,
      agreement: "partial",
      finalDirection: "LONG",
      finalProbability: 66,
    };

    const meta = evaluateMetaLearner(breakdown, {
      regime: "Strong Bull",
      confidence: 95,
      score: 0.8,
      signals: [],
    });
    const aligned = evaluateMetaLearner(
      {
        ...breakdown,
        llm: { direction: "LONG", probability: 70, score: 0.7 },
      },
      {
        regime: "Strong Bull",
        confidence: 95,
        score: 0.8,
        signals: [],
      }
    );
    expect(meta.trustScore).toBeLessThan(aligned.trustScore);
    expect(meta.trustScore).toBeLessThan(85);
  });
});
