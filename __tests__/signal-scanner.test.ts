import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import type { Candle, Timeframe } from "@/types";
import type { PredictorModel } from "@/services/predictor";
import { scanSignals } from "@/services/signal-scanner";
import * as predictor from "@/services/predictor";

const HOUR = 3_600_000;
const NOW = 1000 * HOUR;

function candles(n = 150): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const t = NOW - (n - i) * HOUR;
    return { openTime: t, closeTime: t + HOUR - 1, open: 100, high: 101, low: 99, close: 100, volume: 1 } as Candle;
  });
}

const metrics = { trades: 80, winRate: 0.55, avgNetBp: 6, avgNetBpTaker: 0.5, tStat: 2.2, totalPct: 5, maxDrawdownPct: 2, tradesPerWeek: 3 };

function model(profitable: boolean): PredictorModel {
  return {
    timeframe: "4h",
    interval: "1h",
    symbols: ["BTCUSDT", "ETHUSDT"],
    strategy: {
      profitable,
      reason: "ok",
      best: { setup: { slAtr: 1, rr: 2, horizon: 8, minEdge: 0.04 }, selection: metrics, holdout: metrics },
    },
  } as unknown as PredictorModel;
}

function setup(profitableFor: Timeframe[], pUp = 0.6) {
  const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "scan-")), "state.json");
  const sent: string[] = [];
  let now = NOW;
  vi.spyOn(predictor, "predictWithModel").mockImplementation(
    (m) => ({ probabilityUp: pUp, atr: 2, model: m }) as unknown as ReturnType<typeof predictor.predictWithModel>
  );
  let profitable = profitableFor;
  const deps = {
    candles: async () => candles(),
    send: async (text: string) => {
      sent.push(text);
      return true;
    },
    models: (tf: Timeframe) => (tf === "4h" ? model(profitable.includes("4h")) : null),
    now: () => now,
    stateFile,
  };
  return {
    deps,
    sent,
    advance: (ms: number) => (now += ms),
    setProfitable: (tfs: Timeframe[]) => (profitable = tfs),
  };
}

describe("scanSignals", () => {
  it("sends a validated trade once per coin until its holding time is over", async () => {
    const t = setup(["4h"]);
    const first = await scanSignals(t.deps, false);
    expect(first.sent).toBe(2);
    expect(t.sent[0]).toContain("LONG BTCUSDT");
    expect(t.sent[0]).toContain("TP: 104.00");
    expect(t.sent[0]).toContain("SL: 98.00");

    expect((await scanSignals(t.deps, false)).sent).toBe(0);
    t.advance(9 * HOUR);
    expect((await scanSignals(t.deps, false)).sent).toBe(2);
  });

  it("stays silent on signals weaker than the validated threshold", async () => {
    const t = setup(["4h"], 0.52);
    expect((await scanSignals(t.deps, false)).sent).toBe(0);
  });

  it("sends nothing when no strategy passed validation, and says when one starts to", async () => {
    const t = setup([]);
    expect((await scanSignals(t.deps, false)).sent).toBe(0);
    expect(t.sent).toEqual([]);
    t.setProfitable(["4h"]);
    await scanSignals(t.deps, false);
    expect(t.sent[0]).toContain("прошла проверку на новых данных: 4h");
  });

  it("does nothing until Telegram is connected", async () => {
    const saved = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(os.tmpdir());
    const t = setup(["4h"]);
    const r = await scanSignals(t.deps);
    cwd.mockRestore();
    if (saved) process.env.TELEGRAM_BOT_TOKEN = saved;
    expect(r.skipped).toBe("no_telegram");
    expect(t.sent).toEqual([]);
  });
});
