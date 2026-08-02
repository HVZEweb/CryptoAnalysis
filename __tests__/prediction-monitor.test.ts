import { describe, expect, it } from "vitest";
import {
  buildModelConfidence,
  detectConceptDrift,
  DRIFT_DROP_THRESHOLD,
} from "@/lib/monitoring/prediction-monitor";
import type { MonitoredPrediction } from "@/lib/monitoring/types";

function mockRecord(
  overrides: Partial<MonitoredPrediction> & { outcomeScore?: number; daysAgo?: number }
): MonitoredPrediction {
  const daysAgo = overrides.daysAgo ?? 5;
  const recordedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60_000).toISOString();
  const score = overrides.outcomeScore ?? 80;

  return {
    id: `id-${Math.random()}`,
    recordedAt,
    symbol: "BTC",
    market: "Futures",
    timeframe: "4h",
    direction: "LONG",
    probability: 60,
    confidence: "Medium",
    priceAtPrediction: 100,
    regime: "Strong Bull",
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
    ...overrides,
  };
}

describe("detectConceptDrift", () => {
  it("flags accuracy drop above threshold", () => {
    const baseline = Array.from({ length: 12 }, (_, i) =>
      mockRecord({ daysAgo: 30 + i, outcomeScore: 85, regime: "Strong Bull" })
    );
    const recent = Array.from({ length: 10 }, (_, i) =>
      mockRecord({ daysAgo: 2 + i, outcomeScore: 40, regime: "Strong Bull" })
    );

    const alerts = detectConceptDrift([...baseline, ...recent]);
    const regimeAlert = alerts.find((a) => a.dimension === "regime" && a.key === "Strong Bull");

    expect(regimeAlert).toBeDefined();
    expect(regimeAlert!.dropPct).toBeGreaterThanOrEqual(DRIFT_DROP_THRESHOLD);
  });

  it("returns no alert when accuracy stable", () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      mockRecord({ daysAgo: 5 + i, outcomeScore: 80 })
    );
    const alerts = detectConceptDrift(records);
    expect(alerts.length).toBe(0);
  });
});

describe("buildModelConfidence", () => {
  it("lowers score on drift alert", () => {
    const windows = [
      {
        windowDays: 30,
        total: 20,
        completed: 20,
        inProgress: 0,
        accuracyRate: 0.75,
        winRate: 0.7,
        avgScore: 78,
        avgPriceErrorPct: 1,
      },
    ];
    const noDrift = buildModelConfidence(windows, []);
    const withDrift = buildModelConfidence(windows, [
      {
        dimension: "overall",
        key: "all",
        label: "Overall",
        baselineAccuracy: 0.8,
        recentAccuracy: 0.65,
        dropPct: 0.15,
        baselineSamples: 20,
        recentSamples: 10,
        severity: "critical",
      },
    ]);

    expect(noDrift.score).toBe(75);
    expect(withDrift.score).toBeLessThan(noDrift.score);
    expect(withDrift.driftAlert).toBe(true);
  });
});
