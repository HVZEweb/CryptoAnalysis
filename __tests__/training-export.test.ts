import { describe, expect, it } from "vitest";
import {
  buildTrainingRecord,
  outcomeToLabel,
  writeTrainingJsonl,
} from "@/lib/backtesting/training-export";
import type { EnsembleBreakdown } from "@/types";
import fs from "fs/promises";
import path from "path";
import os from "os";

const mockBreakdown: EnsembleBreakdown = {
  weights: { llm: 0.5, ml: 0.35, rules: 0.15 },
  effectiveWeights: { llm: 0.5, ml: 0.35, rules: 0.15 },
  mlAvailable: true,
  llm: { direction: "LONG", probability: 65, score: 0.5 },
  ml: {
    direction: "LONG",
    probability: 60,
    probabilityUp: 60,
    probabilityDown: 40,
    model: "test",
    confidence: 55,
    keyFeatures: [],
  },
  rules: [],
  rulesAggregateScore: 0.1,
  ensembleScore: 0.3,
  agreement: "full",
  finalDirection: "LONG",
  finalProbability: 62,
};

describe("training-export", () => {
  it("maps price move to label", () => {
    expect(outcomeToLabel(0.5)).toBe(1);
    expect(outcomeToLabel(-0.5)).toBe(-1);
    expect(outcomeToLabel(0.05)).toBe(0);
  });

  it("builds full training record", () => {
    const rec = buildTrainingRecord({
      timestamp: 1_700_000_000_000,
      symbol: "BTC",
      timeframe: "4h",
      features: { rsi_norm: 0.2 },
      regime: { regime: "Strong Bull", confidence: 80, score: 0.5, signals: [] },
      ensembleBreakdown: mockBreakdown,
      entryPrice: 100,
      exitPrice: 101.5,
    });

    expect(rec.label).toBe(1);
    expect(rec.outcome.direction).toBe("LONG");
    expect(rec.features.rsi_norm).toBe(0.2);
    expect(rec.ensembleBreakdown.finalDirection).toBe("LONG");
  });

  it("writes JSONL with one object per line", async () => {
    const tmp = path.join(os.tmpdir(), `bt-train-${Date.now()}.jsonl`);
    const rec = buildTrainingRecord({
      timestamp: Date.now(),
      symbol: "ETH",
      timeframe: "1h",
      features: { macd_hist_norm: -0.1 },
      regime: { regime: "Low Conviction", confidence: 40, score: 0, signals: [] },
      ensembleBreakdown: mockBreakdown,
      entryPrice: 2000,
      exitPrice: 1990,
    });

    const result = await writeTrainingJsonl([rec], tmp);
    expect(result.count).toBe(1);
    expect(result.labeledCount).toBe(1);

    const raw = await fs.readFile(tmp, "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as { symbol: string; label: number };
    expect(parsed.symbol).toBe("ETH");
    expect(parsed.label).toBe(-1);

    await fs.unlink(tmp);
  });
});
