import { beforeAll, describe, expect, it } from "vitest";
import type { Candle } from "@/types";
import { execute, query } from "@/lib/db";
import {
  baselineOf,
  clusterEvents,
  movesAfter,
  newsTopic,
  priceAt,
  studyTopics,
  type NewsEvent,
} from "@/services/news-study/study";
import { fetchGdeltHeadlines, parseGdelt, parseSeenDate } from "@/services/news-study/gdelt";
import { ensureNewsLogTable, fillOutcomes, logNews, similarNewsLine, type LiveStudy } from "@/services/news-study/log";
import type { RawNewsSignal } from "@/services/news-impact/types";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** 5-minute candles whose price is 100 × (1 + drift)^bar. */
function candles(from: number, bars: number, price: (i: number) => number): Candle[] {
  return Array.from({ length: bars }, (_, i) => {
    const p = price(i);
    return { openTime: from + i * 5 * MIN, closeTime: from + (i + 1) * 5 * MIN - 1, open: p, high: p, low: p, close: p, volume: 1 } as Candle;
  });
}

describe("newsTopic", () => {
  it("uses the monitor's rules first, then macro topics", () => {
    expect(newsTopic("Binance will list PEPE perpetuals")).toBe("binance_listing");
    expect(newsTopic("US CPI report comes in hotter than expected")).toBe("cpi_inflation");
    expect(newsTopic("Fed cuts rates by 25 basis points")).toBe("fed_rate_cut");
  });

  it("ignores headlines that only report a move that already happened", () => {
    expect(newsTopic("Bitcoin falls 5% as tariffs rattle markets")).toBeNull();
    expect(newsTopic("ETH surges after ETF approval")).toBeNull();
  });
});

describe("price reaction", () => {
  const start = Date.UTC(2026, 0, 1);
  const c = candles(start, 12 * 30, (i) => 100 + i * 0.1);

  it("takes the open of the first bar at or after the news", () => {
    expect(priceAt(c, start + 7 * MIN)).toBeCloseTo(100.2);
  });

  it("measures each horizon that the candles cover", () => {
    const m = movesAfter(c, start);
    expect(m.h1).toBeCloseTo(((100 + 12 * 0.1) / 100 - 1) * 100);
    expect(m.h24).toBeCloseTo(((100 + 288 * 0.1) / 100 - 1) * 100);
    expect(movesAfter(c, start + 20 * HOUR).h24).toBeUndefined();
  });
});

describe("studyTopics", () => {
  const base = { mean: { m15: 0, h1: 0, h4: 0, h24: 0 }, meanAbs: { m15: 0.2, h1: 0.5, h4: 1, h24: 2 } };
  const ev = (topic: string, i: number, h1: number): NewsEvent => ({ topic, time: i * 7 * HOUR, moves: { h1, h4: h1 } });

  it("counts one story retold within six hours once", () => {
    expect(clusterEvents([ev("a", 0, 1), { topic: "a", time: HOUR, moves: {} }, ev("a", 1, 1)])).toHaveLength(2);
  });

  it("confirms a direction only with enough events, t ≥ 2 and the same sign in both halves", () => {
    const up = Array.from({ length: 30 }, (_, i) => ev("up", i, 0.6 + (i % 3) * 0.1));
    const noisy = Array.from({ length: 30 }, (_, i) => ev("noisy", i, i % 2 ? 2 : -2));
    const few = Array.from({ length: 5 }, (_, i) => ev("few", i, 1));
    const stats = studyTopics([...up, ...noisy, ...few], base);
    const by = (t: string) => stats.find((s) => s.topic === t)!;
    expect(by("up").verdict).toBe("up");
    expect(by("noisy").verdict).toBe("volatile");
    expect(by("few").verdict).toBe("few");
  });

  it("measures the usual move from every hour", () => {
    const b = baselineOf(candles(0, 12 * 50, (i) => 100 + i * 0.1));
    expect(b.meanAbs.h1).toBeGreaterThan(0);
  });
});

describe("GDELT", () => {
  it("parses articles and seen dates", () => {
    expect(parseSeenDate("20240101T121500Z")).toBe(Date.UTC(2024, 0, 1, 12, 15));
    expect(parseGdelt("Please limit requests to one every 5 seconds")).toBeNull();
    expect(parseGdelt(JSON.stringify({ articles: [{ title: "Binance lists X", url: "u", domain: "d", seendate: "20240101T121500Z" }] }))).toHaveLength(1);
  });

  it("splits full windows and keeps the first copy of a syndicated headline", async () => {
    const calls: string[] = [];
    const get = async (url: string) => {
      calls.push(url);
      const from = /startdatetime=(\d+)/.exec(url)![1];
      const full = calls.length === 1; // the first, 6-hour window is full
      const articles = Array.from({ length: full ? 250 : 2 }, (_, i) => ({
        title: i === 0 ? "Same headline" : `News ${from} ${i}`,
        url: `u${i}`,
        domain: "d",
        seendate: `${from.slice(0, 8)}T${from.slice(8, 12)}00Z`,
      }));
      return JSON.stringify({ articles });
    };
    const out = await fetchGdeltHeadlines(Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 1, 6), { get, sleep: async () => undefined });
    expect(calls).toHaveLength(3);
    expect(out.filter((a) => a.title === "Same headline")).toHaveLength(1);
  });
});

describe("similarNewsLine", () => {
  it("tells when a topic has too little history", () => {
    const study: LiveStudy = { since: null, logged: 0, measured: 0, topics: [], coinMoves: {} };
    expect(similarNewsLine(study, "binance_listing")).toContain("копится");
    expect(similarNewsLine(study, null)).toBeNull();
  });
});

// Touches real tables, so it only runs against a throwaway *_ci database (as in CI).
const onCiDb = (process.env.DB_NAME ?? "").endsWith("_ci");

describe.runIf(onCiDb)("news log", () => {
  beforeAll(async () => {
    await ensureNewsLogTable();
    await execute("DELETE FROM news_log");
  });

  it("stores each headline once with its topic and fills BTC moves a day later", async () => {
    const t = Date.UTC(2026, 0, 1, 12);
    const signal = {
      id: "abc",
      title: "Binance will list SOL perpetuals",
      source: "test",
      sourceType: "rss",
      publishedAt: new Date(t).toISOString(),
      keywordHits: [],
      significanceScore: 50,
    } as RawNewsSignal;
    expect(await logNews([signal], t + 5 * MIN)).toBe(1);
    expect(await logNews([signal], t + 6 * MIN)).toBe(0);

    const series = candles(t - HOUR, 12 * 27, (i) => 100 + i * 0.1);
    const filled = await fillOutcomes({ candles: async () => series, now: () => t + 26 * HOUR });
    expect(filled).toBe(1);
    const [row] = await query<Array<{ topic: string; coin: string; btc_h1: number; coin_h1: number; outcome_done: number }>>(
      "SELECT topic, coin, btc_h1, coin_h1, outcome_done FROM news_log WHERE id = 'abc'"
    );
    expect(row.topic).toBe("binance_listing");
    expect(row.coin).toBe("SOL");
    expect(row.outcome_done).toBe(1);
    expect(row.btc_h1).toBeGreaterThan(0);
    expect(row.coin_h1).toBeGreaterThan(0);
  });
});

describe("GDELT outage", () => {
  it("gives up after five windows in a row without an answer", async () => {
    let calls = 0;
    const get = async () => {
      calls++;
      return "Please limit requests";
    };
    await expect(
      fetchGdeltHeadlines(Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 5), { get, sleep: async () => undefined })
    ).rejects.toThrow("не отвечает");
    expect(calls).toBe(5 * 4);
  });
});
