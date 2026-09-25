import { describe, expect, it, vi } from "vitest";
import * as openrouter from "@/services/openrouter";
import { generatePrediction } from "@/services/ai-prediction";
import { directionEdge } from "@/services/ensemble-prediction";
import type { AnalysisContext } from "@/types";

const ctx = {
  coin: { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  market: "Futures",
  timeframe: "15m",
  marketData: { price: 84000 },
  volatility: { atr: 150 },
} as unknown as AnalysisContext;

describe("generatePrediction", () => {
  it("falls back to a neutral vote when OpenRouter is unreachable", async () => {
    vi.spyOn(openrouter, "generateOpenRouterPrediction").mockRejectedValueOnce({ message: "403 region blocked" });
    const out = await generatePrediction(ctx);
    expect(out.direction).toBe("SIDEWAYS");
    expect(directionEdge(out.direction, out.probability)).toBe(0);
    expect(out.refinementNotes?.[0]).toContain("403 region blocked");
  });
});
