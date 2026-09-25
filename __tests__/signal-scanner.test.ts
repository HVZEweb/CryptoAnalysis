import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import type { Candle } from "@/types";
import type { PredictorModel } from "@/services/predictor";
import { scanSignals, type ModelEntry, type ScanDeps, type SignalStore } from "@/services/signal-scanner";
import type { SignalRow } from "@/services/signals/store";
import * as predictor from "@/services/predictor";

const HOUR = 3_600_000;
const NOW = 1000 * HOUR;

function candles(until: number, price = 100): Candle[] {
  return Array.from({ length: 150 }, (_, i) => {
    const t = until - (150 - i) * HOUR;
    return { openTime: t, closeTime: t + HOUR - 1, open: price, high: price + 1, low: price - 1, close: price, volume: 1 } as Candle;
  });
}

const metrics = (avgNetBp = 6, trades = 80) => ({ trades, winRate: 0.55, avgNetBp, avgNetBpTaker: 0.5, tStat: 2.2, totalPct: 5, maxDrawdownPct: 2, tradesPerWeek: 3 });

function model(profitable: boolean, bySymbol?: Record<string, ReturnType<typeof metrics>>): PredictorModel {
  return {
    timeframe: "4h",
    interval: "1h",
    trainedAt: "2026-01-01T00:00:00Z",
    symbols: ["BTCUSDT", "ETHUSDT"],
    validation: { hasEdge: true },
    strategy: {
      profitable,
      reason: "ok",
      best: { setup: { slAtr: 1, rr: 2, horizon: 8, minEdge: 0.04 }, selection: metrics(), holdout: metrics() },
      bySymbol,
    },
  } as unknown as PredictorModel;
}

function memoryStore(watch: string[]) {
  const rows: SignalRow[] = [];
  const disabled = new Map<string, { trainedAt: string; reason: string }>();
  const settings = { paused: false, observe: false };
  const store: SignalStore = {
    getChat: async () => ({ ...settings }),
    getWatchlist: async () => [...watch],
    logSignal: async (s) => {
      rows.push({ ...s, id: rows.length + 1, status: "open", exit_price: null, gross_bp: null, net_bp: null, closed_at: null });
      return rows.length;
    },
    openSignals: async () => rows.filter((r) => r.status === "open"),
    closeSignal: async (id, o) => {
      const r = rows.find((x) => x.id === id)!;
      Object.assign(r, { status: o.status, exit_price: o.exitPrice, gross_bp: o.grossBp, net_bp: o.netBp, closed_at: o.closedAt });
    },
    closedSignals: async (f = {}) =>
      rows.filter((r) => r.status !== "open" && (!f.modelKey || r.model_key === f.modelKey) && (!f.trainedAt || r.model_trained_at === f.trainedAt)),
    disabledModels: async () => disabled,
    disableModel: async (key, trainedAt, reason) => void disabled.set(key, { trainedAt, reason }),
  };
  return { store, rows, disabled, settings };
}

function setup(opts: { profitable?: boolean; pUp?: number; watch?: string[]; bySymbol?: Record<string, ReturnType<typeof metrics>> } = {}) {
  const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "scan-")), "state.json");
  const sent: string[] = [];
  let now = NOW;
  let price = 100;
  vi.spyOn(predictor, "predictWithModel").mockImplementation(
    (m) => ({ probabilityUp: opts.pUp ?? 0.6, atr: 2, model: m }) as unknown as ReturnType<typeof predictor.predictWithModel>
  );
  const mem = memoryStore(opts.watch ?? ["BTCUSDT", "ETHUSDT"]);
  let entry: ModelEntry = { key: "candles:4h", kind: "candles", timeframe: "4h", model: model(opts.profitable ?? true, opts.bySymbol) };
  const deps: ScanDeps = {
    chatId: () => "42",
    send: async (text) => {
      sent.push(text);
      return true;
    },
    candles: async () => candles(now - (now % HOUR), price),
    derivs: async () => ({ points: [], funding: [] }),
    models: () => [entry],
    store: mem.store,
    now: () => now,
    stateFile,
  };
  return {
    deps,
    sent,
    mem,
    advance: (ms: number) => (now += ms),
    setPrice: (p: number) => (price = p),
    setModel: (m: PredictorModel) => (entry = { ...entry, model: m }),
  };
}

describe("scanSignals", () => {
  it("sends a validated trade for watched coins only, logs it, and does not repeat it while open", async () => {
    const t = setup({ watch: ["BTCUSDT"] });
    const first = await scanSignals(t.deps);
    expect(first.sent).toBe(1);
    expect(t.sent[0]).toContain("LONG BTCUSDT");
    expect(t.sent[0]).toContain("TP: 104.00");
    expect(t.sent[0]).toContain("SL: 98.00");
    expect(t.mem.rows).toHaveLength(1);
    expect((await scanSignals(t.deps)).sent).toBe(0);
  });

  it("closes a signal at its target and reports the result after fees", async () => {
    const t = setup({ watch: ["BTCUSDT"] });
    await scanSignals(t.deps);
    t.advance(3 * HOUR);
    t.setPrice(105); // bars now reach the 104 target
    const r = await scanSignals(t.deps);
    expect(r.closed).toBe(1);
    expect(t.mem.rows[0].status).toBe("tp");
    expect(t.mem.rows[0].net_bp).toBeCloseTo(400 - 10); // market entry + slippage, limit take-profit
    expect(t.sent.some((m) => m.includes("цель достигнута"))).toBe(true);
  });

  it("skips a coin on which the model's setup lost money in validation", async () => {
    const t = setup({ bySymbol: { BTCUSDT: metrics(5), ETHUSDT: metrics(-3) } });
    await scanSignals(t.deps);
    expect(t.sent.map((m) => m.split("\n")[0])).toEqual([expect.stringContaining("BTCUSDT")]);
  });

  it("stays silent on signals weaker than the validated threshold", async () => {
    const t = setup({ pUp: 0.52 });
    expect((await scanSignals(t.deps)).sent).toBe(0);
  });

  it("sends nothing when no strategy passed validation, and says when one starts to", async () => {
    const t = setup({ profitable: false });
    expect((await scanSignals(t.deps)).sent).toBe(0);
    expect(t.sent).toEqual([]);
    t.setModel(model(true));
    await scanSignals(t.deps);
    expect(t.sent[0]).toContain("прошла проверку на новых данных");
  });

  it("switches a model off when its live signals lose money after fees", async () => {
    const t = setup({ watch: ["BTCUSDT"] });
    const lost = { chat_id: "42", model_key: "candles:4h", model_trained_at: "2026-01-01T00:00:00Z", symbol: "BTCUSDT", timeframe: "4h", bar_interval: "1h" };
    for (let i = 0; i < 29; i++) {
      t.mem.rows.push({ ...lost, id: 100 + i, side: "LONG", entry: 100, tp: 104, sl: 98, entry_time: 0, close_by: 1, sent_at: 0, status: "sl", exit_price: 98, gross_bp: -200, net_bp: -204, closed_at: 1 });
    }
    await scanSignals(t.deps); // the 30th signal opens…
    t.advance(2 * HOUR);
    t.setPrice(97); // …and hits its 98 stop
    await scanSignals(t.deps);
    expect(t.mem.disabled.get("candles:4h")?.trainedAt).toBe("2026-01-01T00:00:00Z");
    expect(t.sent.some((m) => m.includes("остановлены"))).toBe(true);
    t.setPrice(100);
    expect((await scanSignals(t.deps)).sent).toBe(0);
  });

  it("does nothing until Telegram is connected", async () => {
    const t = setup();
    const r = await scanSignals({ ...t.deps, chatId: () => null });
    expect(r.skipped).toBe("no_telegram");
    expect(t.sent).toEqual([]);
  });
});
