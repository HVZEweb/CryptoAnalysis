import { beforeAll, describe, expect, it } from "vitest";
import type { AxiosInstance } from "axios";
import { execute, query } from "@/lib/db";
import {
  collectMarketData,
  ensureMarketTables,
  premiumRows,
  SERIES,
  seriesRows,
  topSymbols,
  upsertMetrics,
} from "@/services/market-data/collector";

describe("market data parsing", () => {
  it("picks the most traded USDT perpetuals and skips stablecoins and dated futures", () => {
    const tickers = [
      { symbol: "ETHUSDT", quoteVolume: "500" },
      { symbol: "BTCUSDT", quoteVolume: "900" },
      { symbol: "USDCUSDT", quoteVolume: "2000" },
      { symbol: "BTCUSDT_261225", quoteVolume: "3000" },
      { symbol: "ETHBTC", quoteVolume: "3000" },
      { symbol: "SOLUSDT", quoteVolume: "100" },
    ];
    expect(topSymbols(tickers, 2)).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("aligns series to 5-minute bars", () => {
    const [row] = seriesRows("BTCUSDT", SERIES[0], [
      { timestamp: 1_700_000_123_456, sumOpenInterest: "10.5", sumOpenInterestValue: "700000" },
    ]);
    expect(row).toEqual({ symbol: "BTCUSDT", ts: 1_700_000_100_000, open_interest: 10.5, open_interest_value: 700000 });
  });

  it("keeps only tracked symbols from the premium index", () => {
    const rows = premiumRows(
      [
        { symbol: "BTCUSDT", time: 1_700_000_000_000, markPrice: "1", indexPrice: "2", lastFundingRate: "0.0001" },
        { symbol: "DOGEUSDT", time: 1_700_000_000_000, markPrice: "1", indexPrice: "2", lastFundingRate: "0.0001" },
      ],
      new Set(["BTCUSDT"])
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].funding_rate).toBe(0.0001);
  });
});

// Touches real tables, so it only runs against a throwaway *_ci database (as in CI).
const onCiDb = (process.env.DB_NAME ?? "").endsWith("_ci");

describe.runIf(onCiDb)("market data storage", () => {
  beforeAll(async () => {
    await ensureMarketTables();
    await execute("DELETE FROM market_metrics_5m");
    await execute("DELETE FROM funding_rates");
  });

  it("merges columns from different endpoints without erasing stored values", async () => {
    await upsertMetrics([{ symbol: "BTCUSDT", ts: 1000, open_interest: 5 }]);
    await upsertMetrics([{ symbol: "BTCUSDT", ts: 1000, global_ls_ratio: 1.8 }]);
    const [row] = await query<Array<{ open_interest: number; global_ls_ratio: number }>>(
      "SELECT open_interest, global_ls_ratio FROM market_metrics_5m WHERE symbol = 'BTCUSDT' AND ts = 1000"
    );
    expect(row).toEqual({ open_interest: 5, global_ls_ratio: 1.8 });
  });

  it("collects from Binance and resumes where it stopped", async () => {
    const now = Date.UTC(2026, 0, 10);
    const calls: string[] = [];
    const fake = (handler: (path: string, params: Record<string, number | string>) => unknown) =>
      ({
        get: async (path: string, cfg?: { params?: Record<string, number | string> }) => {
          calls.push(`${path}:${cfg?.params?.startTime ?? ""}:${cfg?.params?.endTime ?? ""}`);
          return { data: handler(path, cfg?.params ?? {}) };
        },
      }) as unknown as AxiosInstance;

    const futures = fake((path, params) => {
      if (path === "/premiumIndex") return [{ symbol: "ETHUSDT", time: now, markPrice: "3000", indexPrice: "2999", lastFundingRate: "0.0001" }];
      if (path === "/fundingRate") {
        const start = Number(params.startTime);
        return start > now - 86_400_000 ? [] : [{ fundingTime: now - 8 * 3_600_000, fundingRate: "0.0002", markPrice: "3000" }];
      }
      return [];
    });
    const futuresData = fake((path, params) =>
      params.startTime && Number(params.startTime) < now - 3_600_000
        ? [{ timestamp: now - 600_000, sumOpenInterest: "7", sumOpenInterestValue: "21000", longShortRatio: "1.5", buySellRatio: "0.9" }]
        : []
    );
    const deps = { futures, futuresData, sleep: async () => undefined, now: () => now };

    const first = await collectMarketData({ symbols: ["ETHUSDT"], fundingBackfillDays: 2 }, deps);
    expect(first.errors).toEqual([]);
    expect(first.fundingRows).toBe(1);
    const [row] = await query<Array<Record<string, number>>>(
      "SELECT open_interest, global_ls_ratio, taker_buy_sell_ratio FROM market_metrics_5m WHERE symbol = 'ETHUSDT' AND ts = ?",
      [now - 600_000]
    );
    expect(row).toEqual({ open_interest: 7, global_ls_ratio: 1.5, taker_buy_sell_ratio: 0.9 });

    // Binance ignores a bare startTime and returns the latest page, so every request is an explicit window.
    const firstWindows = calls
      .filter((c) => c.startsWith("/openInterestHist"))
      .map((c) => c.split(":").slice(1).map(Number));
    expect(firstWindows[0][0]).toBe(now - 30 * 86_400_000 + 300_000);
    expect(firstWindows.every(([s, e]) => e > s && e - s < 500 * 300_000)).toBe(true);
    expect(firstWindows.length).toBeGreaterThan(10); // 30 days in ~42-hour pages

    calls.length = 0;
    const second = await collectMarketData({ symbols: ["ETHUSDT"] }, deps);
    expect(second.fundingRows).toBe(0);
    // Resumes half an hour before the last stored bar instead of re-reading 30 days.
    const starts = calls.filter((c) => c.startsWith("/openInterestHist")).map((c) => Number(c.split(":")[1]));
    expect(starts).toContain(now - 600_000 - 30 * 60_000);
  });
});
