import { describe, expect, it } from "vitest";
import type { Candle } from "@/types";
import type { PredictorModel } from "@/services/predictor";
import {
  coinVerdict,
  DISABLE_AFTER,
  disableReason,
  evaluateOutcome,
  normalizeSymbol,
  parseCommand,
  trackRecord,
} from "@/services/signals/logic";
import { handleCommand, type BotDeps } from "@/services/signals/bot";

const HOUR = 3_600_000;
const bar = (i: number, low: number, high: number, close = (low + high) / 2): Candle =>
  ({ openTime: i * HOUR, closeTime: (i + 1) * HOUR - 1, open: close, high, low, close, volume: 1 }) as Candle;

describe("parsing", () => {
  it("normalises coin names", () => {
    expect(normalizeSymbol("sol")).toBe("SOLUSDT");
    expect(normalizeSymbol("$DOGE")).toBe("DOGEUSDT");
    expect(normalizeSymbol("eth/usdt")).toBe("ETHUSDT");
    expect(normalizeSymbol("1000PEPE")).toBe("1000PEPEUSDT");
    expect(normalizeSymbol("not a coin!")).toBeNull();
  });

  it("parses commands with arguments and bot mentions", () => {
    expect(parseCommand("/watch sol, doge")).toEqual({ cmd: "watch", args: ["sol", "doge"] });
    expect(parseCommand("/list@my_bot")).toEqual({ cmd: "list", args: [] });
    expect(parseCommand("hello")).toBeNull();
  });
});

describe("evaluateOutcome", () => {
  const signal = { side: "LONG" as const, entry: 100, tp: 104, sl: 98, entry_time: 10 * HOUR, close_by: 14 * HOUR };

  it("is open until a level is touched or time runs out", () => {
    expect(evaluateOutcome(signal, [bar(9, 90, 110), bar(10, 99, 101)])).toBeNull();
  });

  it("ignores bars before the entry", () => {
    expect(evaluateOutcome(signal, [bar(9, 90, 110), bar(10, 99, 101), bar(11, 99, 105)])!.status).toBe("tp");
  });

  it("counts the stop first when one bar touches both levels, and charges fees", () => {
    const o = evaluateOutcome(signal, [bar(10, 97, 105)])!;
    expect(o.status).toBe("sl");
    expect(o.grossBp).toBeCloseTo(-200);
    expect(o.netBp).toBeCloseTo(-216); // market in and out, with slippage
  });

  it("closes at the last bar's close when the holding time is over", () => {
    const o = evaluateOutcome(signal, [10, 11, 12, 13].map((i) => bar(i, 99, 101, 101)))!;
    expect(o.status).toBe("timeout");
    expect(o.exitPrice).toBe(101);
  });

  it("works for shorts", () => {
    const short = { ...signal, side: "SHORT" as const, tp: 96, sl: 102 };
    expect(evaluateOutcome(short, [bar(10, 95, 101)])!.status).toBe("tp");
  });
});

describe("track record and auto-disable", () => {
  it("needs enough live signals and a losing average", () => {
    const losing = Array.from({ length: DISABLE_AFTER }, () => ({ net_bp: -5 }));
    expect(disableReason(losing.slice(1))).toBeNull();
    expect(disableReason(losing)).toContain("хуже, чем на проверке");
    expect(disableReason(losing.map((r, i) => ({ net_bp: i % 2 ? 20 : -5 })))).toBeNull();
  });

  it("sums results", () => {
    expect(trackRecord([{ net_bp: 30 }, { net_bp: -10 }])).toEqual({ closed: 2, wins: 1, avgNetBp: 10, sumNetPct: 0.2 });
  });
});

describe("coinVerdict", () => {
  const m = (profitable: boolean, bySymbol?: Record<string, { trades: number; avgNetBp: number; winRate: number }>) =>
    ({
      symbols: ["BTCUSDT", "ETHUSDT"],
      strategy: { profitable, reason: "нет", best: { holdout: { avgNetBp: 5 } }, bySymbol },
    }) as unknown as PredictorModel;

  it("allows only coins where the validated setup also paid", () => {
    const model = m(true, { BTCUSDT: { trades: 40, avgNetBp: 7, winRate: 0.55 }, ETHUSDT: { trades: 40, avgNetBp: -2, winRate: 0.5 } });
    expect(coinVerdict(model, "BTCUSDT").ok).toBe(true);
    expect(coinVerdict(model, "ETHUSDT").ok).toBe(false);
    expect(coinVerdict(model, "SOLUSDT").text).toContain("не обучалась");
  });

  it("needs enough trades on the coin and an overall pass", () => {
    expect(coinVerdict(m(true, { BTCUSDT: { trades: 3, avgNetBp: 50, winRate: 1 } }), "BTCUSDT").ok).toBe(false);
    expect(coinVerdict(m(false), "BTCUSDT").ok).toBe(false);
  });
});

describe("bot commands", () => {
  function deps(): BotDeps & { watch: string[] } {
    const watch: string[] = [];
    let settings = { paused: false, observe: false };
    return {
      watch,
      store: {
        addWatch: async (_c, s) => void watch.push(...s),
        removeWatch: async (_c, s) => {
          const before = watch.length;
          s.forEach((x) => watch.includes(x) && watch.splice(watch.indexOf(x), 1));
          return before - watch.length;
        },
        getWatchlist: async () => [...watch],
        getChat: async () => settings,
        setChat: async (_c, p) => void (settings = { ...settings, ...p }),
        closedSignals: async () => [],
        openSignals: async () => [],
      },
      models: () => [],
      symbolExists: async (s) => s !== "FAKEUSDT",
    };
  }

  it("adds coins, rejects unknown ones and explains why a coin gets no signals", async () => {
    const d = deps();
    const reply = await handleCommand("42", "/watch sol fake", d);
    expect(d.watch).toEqual(["SOLUSDT"]);
    expect(reply).toContain("Нет на фьючерсах Binance: FAKEUSDT");
    expect(reply).toContain("общая модель ещё не обучена");
    expect(await handleCommand("42", "/unwatch sol", d)).toContain("Убрано: 1");
  });

  it("pauses and turns observe mode on", async () => {
    const d = deps();
    await handleCommand("42", "/pause", d);
    expect((await d.store.getChat("42")).paused).toBe(true);
    expect(await handleCommand("42", "/observe on", d)).toContain("не торговые сигналы");
    expect((await d.store.getChat("42")).observe).toBe(true);
  });
});
