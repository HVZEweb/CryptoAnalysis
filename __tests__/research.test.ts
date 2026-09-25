import { describe, expect, it } from "vitest";
import type { Candle } from "@/types";
import { POOLED_FEATURE_NAMES } from "@/services/pooled/features";
import { barrierLabel } from "@/services/research/bigmove";
import { detectEvents, EVENT_COOLDOWN, EVENTS } from "@/services/research/events";
import { selectAndValidate, simulateIntents, type ResearchTrade } from "@/services/research/common";

const HOUR = 3_600_000;
const bar = (i: number, low: number, high: number, close = (low + high) / 2): Candle =>
  ({ openTime: i * HOUR, closeTime: (i + 1) * HOUR - 1, open: close, high, low, close, volume: 1 }) as Candle;

function row(values: Partial<Record<(typeof POOLED_FEATURE_NAMES)[number], number>>): number[] {
  return POOLED_FEATURE_NAMES.map((n) => values[n] ?? 0);
}

describe("barrierLabel", () => {
  const candles = [bar(0, 100, 100, 100), bar(1, 99.5, 100.5), bar(2, 99.8, 101.2), bar(3, 98, 99)];

  it("labels which barrier price reached first", () => {
    expect(barrierLabel(candles, 0, 0.01, 3)).toBe(1);
    expect(barrierLabel([bar(0, 100, 100, 100), bar(1, 98.9, 100)], 0, 0.01, 1)).toBe(-1);
  });

  it("is neutral when neither is reached, or both inside one bar", () => {
    expect(barrierLabel(candles, 0, 0.05, 3)).toBe(0);
    expect(barrierLabel([bar(0, 100, 100, 100), bar(1, 98, 102)], 0, 0.01, 1)).toBe(0);
  });

  it("has no label without the full horizon ahead", () => {
    expect(barrierLabel(candles, 2, 0.01, 3)).toBeNull();
  });
});

describe("detectEvents", () => {
  const spike = EVENTS.find((e) => e.key === "oi_spike")!;
  const flush = EVENTS.find((e) => e.key === "oi_flush")!;

  it("fires on a sharp open-interest jump and points along the price move", () => {
    const rows = [row({}), row({ oi_chg_1: 3.5, ret_1: -1 }), row({ oi_chg_1: 1 })];
    expect(detectEvents(spike, [{ symbol: "X", candles: [], rows }])).toEqual([{ symbol: "X", index: 1, side: -1 }]);
  });

  it("counts a wave once per cooldown", () => {
    const rows = Array.from({ length: EVENT_COOLDOWN + 5 }, () => row({ oi_chg_1: 4, ret_1: 1 }));
    expect(detectEvents(spike, [{ symbol: "X", candles: [], rows }]).map((h) => h.index)).toEqual([0, EVENT_COOLDOWN]);
  });

  it("needs both the open-interest drop and a sharp move for the liquidation proxy", () => {
    const rows = [row({ oi_chg_1: -4, ret_1: 0.5 }), row({ oi_chg_1: -4, ret_1: -3 })];
    expect(detectEvents(flush, [{ symbol: "X", candles: [], rows }]).map((h) => h.index)).toEqual([1]);
  });
});

describe("simulateIntents", () => {
  it("holds one position per coin at a time", () => {
    const candles = [bar(0, 100, 100, 100), bar(1, 100, 100.5), bar(2, 100, 100.5), bar(3, 100, 103)];
    const trades = simulateIntents(
      [
        { symbol: "X", index: 0, side: 1, slDist: 2, tpDist: 2, horizon: 3 },
        { symbol: "X", index: 1, side: 1, slDist: 2, tpDist: 2, horizon: 3 },
      ],
      new Map([["X", candles]])
    );
    expect(trades).toHaveLength(1);
    expect(trades[0].exit).toBe("tp");
  });
});

describe("selectAndValidate", () => {
  const DAY = 86_400_000;
  const trades = (n: number, gross: (i: number) => number, start: number, span: number): ResearchTrade[] =>
    Array.from({ length: n }, (_, i) => ({ symbol: "X", time: start + (i / n) * span, gross: gross(i), exit: gross(i) > 0 ? "tp" : "sl" }));

  it("passes a variant that pays after costs on both periods", () => {
    const t = trades(200, (i) => (i % 3 === 0 ? -0.01 : 0.012), 0, 100 * DAY);
    const v = selectAndValidate("x", [{ label: "a", trades: t }], 0, 100 * DAY);
    expect(v.passed).toBe(true);
  });

  it("rejects a variant that only paid on the selection period", () => {
    const t = [...trades(100, () => 0.01, 0, 60 * DAY), ...trades(100, (i) => (i % 2 ? 0.01 : -0.012), 60 * DAY, 40 * DAY)];
    const v = selectAndValidate("x", [{ label: "a", trades: t }], 0, 100 * DAY);
    expect(v.passed).toBe(false);
    expect(v.reason).toMatch(/на проверке/);
  });

  it("does not pass on too few trades", () => {
    const v = selectAndValidate("x", [{ label: "a", trades: trades(20, () => 0.02, 0, 100 * DAY) }], 0, 100 * DAY);
    expect(v.passed).toBe(false);
  });
});
