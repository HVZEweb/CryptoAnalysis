import { describe, expect, it } from "vitest";
import { formatBotAlert, shouldSendAlert } from "@/services/news-impact/alerts";
import { strongNewsRecord, type NewsImpactHistoryRow } from "@/services/news-impact/history";
import type { NewsImpactPrediction } from "@/services/news-impact/types";

const prediction = {
  coin: "SOL",
  direction: "LONG",
  impactScore: 88,
  strength: "Extreme",
  urgency: "Immediate",
  reason: "ETF <approved>",
  suggestedHoldTime: "15–60 мин",
  expectedMovePct: 3.5,
  sourceUrl: "https://example.com/a?b=1&c=2",
  confidence: 70,
} as unknown as NewsImpactPrediction;

function row(dir: string, move60: number | null, impact = 80): NewsImpactHistoryRow {
  return { predictedDirection: dir, impactScore: impact, actualMove60m: move60 } as unknown as NewsImpactHistoryRow;
}

describe("strongNewsRecord", () => {
  it("scores only strong, finished directional calls, in the predicted direction", () => {
    const r = strongNewsRecord([
      row("LONG", 1),
      row("SHORT", 2),
      row("SHORT", -1),
      row("LONG", null),
      row("SIDEWAYS", 3),
      row("LONG", 5, 40),
    ]);
    expect(r.count).toBe(3);
    expect(r.hitRate).toBeCloseTo(2 / 3);
    expect(r.avgMovePct).toBeCloseTo((1 - 2 + 1) / 3);
  });
});

describe("news alerts for the connected bot", () => {
  it("never alerts on a sideways call", () => {
    expect(shouldSendAlert(prediction)).toBe(true);
    expect(shouldSendAlert({ ...prediction, direction: "SIDEWAYS" })).toBe(false);
  });

  it("escapes HTML and states the real track record", () => {
    const text = formatBotAlert(prediction, { count: 40, hitRate: 0.55, avgMovePct: 0.21 }, "SEC & ETF");
    expect(text).toContain("LONG SOL");
    expect(text).toContain("ETF &lt;approved&gt;");
    expect(text).toContain("SEC &amp; ETF");
    expect(text).toContain("в 55% случаев");
    expect(text).toContain("не проверенная стратегия");
  });

  it("says when there is no track record yet", () => {
    expect(formatBotAlert(prediction, { count: 3, hitRate: 1, avgMovePct: 2 })).toContain("пока не набрана");
  });
});
