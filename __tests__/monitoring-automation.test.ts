import { describe, expect, it } from "vitest";
import { detectSharpDropAlerts } from "@/lib/monitoring/alerts";
import { evaluateRetrainNeed } from "@/lib/monitoring/retraining-scheduler";
import type { MonitoredPrediction } from "@/lib/monitoring/types";

function mockRecord(daysAgo: number, score: number, regime = "Strong Bull"): MonitoredPrediction {
  const recordedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60_000).toISOString();
  return {
    id: `r-${daysAgo}-${score}`,
    recordedAt,
    symbol: "BTC",
    market: "Futures",
    timeframe: "4h",
    direction: "LONG",
    probability: 60,
    confidence: "Medium",
    priceAtPrediction: 100,
    regime,
    outcome: {
      evaluatedAt: recordedAt,
      actualPrice: 101,
      score,
      isCorrect: score >= 72,
      label: score >= 72 ? "Точно" : "Мимо",
      percentChange: 1,
      timeframePhase: "completed",
      priceErrorPct: 0.5,
    },
  };
}

describe("detectSharpDropAlerts", () => {
  it("detects 7d accuracy collapse", () => {
    const prior = Array.from({ length: 8 }, (_, i) => mockRecord(8 + i * 0.5, 85));
    const recent = Array.from({ length: 8 }, (_, i) => mockRecord(0.5 + i * 0.5, 40));
    const alerts = detectSharpDropAlerts([...prior, ...recent]);
    expect(alerts.length).toBe(1);
    expect(alerts[0].kind).toBe("sharp_drop");
  });
});

describe("evaluateRetrainNeed", () => {
  it("returns a decision object", async () => {
    const decision = await evaluateRetrainNeed();
    expect(decision).toHaveProperty("shouldRun");
    expect(decision).toHaveProperty("reason");
  });
});
