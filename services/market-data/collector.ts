/**
 * Market-data collector for Binance USDT perpetuals: open interest, long/short ratios, taker flow,
 * mark/index price and funding. Binance keeps the 5-minute series for only 30 days, so the collector
 * runs every few minutes and accumulates them in MySQL; funding rates are backfilled for years.
 *
 * Liquidations are only published over websocket (the REST endpoint was retired), so they are not
 * collected here.
 */

import type { AxiosInstance } from "axios";
import { binanceFuturesClient, binanceFuturesDataClient } from "@/lib/axios";
import { execute, query } from "@/lib/db";

const FIVE_MIN = 5 * 60_000;
const DAY = 86_400_000;
/** Binance serves /futures/data series for the last 30 days only. */
const SERIES_RETENTION_MS = 30 * DAY;
const SERIES_PAGE = 500;
/** Futures data endpoints allow ~1000 requests per 5 minutes per IP; stay well below. */
const REQUEST_GAP_MS = 400;

const STABLES = new Set(["USDCUSDT", "FDUSDUSDT", "TUSDUSDT", "USDPUSDT", "DAIUSDT", "BUSDUSDT", "USDEUSDT"]);

export type MetricColumn =
  | "open_interest"
  | "open_interest_value"
  | "global_ls_ratio"
  | "top_ls_position_ratio"
  | "taker_buy_sell_ratio"
  | "mark_price"
  | "index_price"
  | "funding_rate";

export const METRIC_COLUMNS: MetricColumn[] = [
  "open_interest",
  "open_interest_value",
  "global_ls_ratio",
  "top_ls_position_ratio",
  "taker_buy_sell_ratio",
  "mark_price",
  "index_price",
  "funding_rate",
];

export type MetricRow = { symbol: string; ts: number } & Partial<Record<MetricColumn, number>>;

export interface FundingRow {
  symbol: string;
  fundingTime: number;
  rate: number;
  markPrice: number | null;
}

let tablesReady = false;

export async function ensureMarketTables(): Promise<void> {
  if (tablesReady) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS market_metrics_5m (
      symbol VARCHAR(30) NOT NULL,
      ts BIGINT NOT NULL,
      ${METRIC_COLUMNS.map((c) => `${c} DOUBLE NULL`).join(",\n      ")},
      PRIMARY KEY (symbol, ts),
      INDEX idx_market_metrics_ts (ts)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS funding_rates (
      symbol VARCHAR(30) NOT NULL,
      funding_time BIGINT NOT NULL,
      rate DOUBLE NOT NULL,
      mark_price DOUBLE NULL,
      PRIMARY KEY (symbol, funding_time)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tablesReady = true;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
};

/** Rows from different endpoints for the same 5-minute bar merge; a missing value never erases a stored one. */
export async function upsertMetrics(rows: MetricRow[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureMarketTables();
  const cols = ["symbol", "ts", ...METRIC_COLUMNS];
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const params = chunk.flatMap((r) => [r.symbol, r.ts, ...METRIC_COLUMNS.map((c) => r[c] ?? null)]);
    await execute(
      `INSERT INTO market_metrics_5m (${cols.join(", ")}) VALUES ${chunk.map(() => `(${cols.map(() => "?").join(", ")})`).join(", ")}
       ON DUPLICATE KEY UPDATE ${METRIC_COLUMNS.map((c) => `${c} = COALESCE(VALUES(${c}), ${c})`).join(", ")}`,
      params
    );
    written += chunk.length;
  }
  return written;
}

export async function upsertFunding(rows: FundingRow[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureMarketTables();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await execute(
      `INSERT INTO funding_rates (symbol, funding_time, rate, mark_price) VALUES ${chunk.map(() => "(?, ?, ?, ?)").join(", ")}
       ON DUPLICATE KEY UPDATE rate = VALUES(rate), mark_price = COALESCE(VALUES(mark_price), mark_price)`,
      chunk.flatMap((r) => [r.symbol, r.fundingTime, r.rate, r.markPrice])
    );
  }
  return rows.length;
}

/** The most liquid USDT perpetuals by 24h quote volume, stablecoin pairs excluded. */
export function topSymbols(tickers: Array<{ symbol: string; quoteVolume: string | number }>, count: number): string[] {
  return tickers
    .filter((t) => /^[A-Z0-9]+USDT$/.test(t.symbol) && !STABLES.has(t.symbol))
    .map((t) => ({ symbol: t.symbol, volume: num(t.quoteVolume) ?? 0 }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, count)
    .map((t) => t.symbol);
}

interface SeriesSpec {
  path: string;
  /** Column this series fills — where it resumes from */
  column: MetricColumn;
  map: (r: Record<string, unknown>) => Partial<Record<MetricColumn, number>>;
}

/** /futures/data endpoints, all on 5-minute bars. */
export const SERIES: SeriesSpec[] = [
  {
    path: "/openInterestHist",
    column: "open_interest",
    map: (r) => ({ open_interest: num(r.sumOpenInterest), open_interest_value: num(r.sumOpenInterestValue) }),
  },
  { path: "/globalLongShortAccountRatio", column: "global_ls_ratio", map: (r) => ({ global_ls_ratio: num(r.longShortRatio) }) },
  { path: "/topLongShortPositionRatio", column: "top_ls_position_ratio", map: (r) => ({ top_ls_position_ratio: num(r.longShortRatio) }) },
  { path: "/takerlongshortRatio", column: "taker_buy_sell_ratio", map: (r) => ({ taker_buy_sell_ratio: num(r.buySellRatio) }) },
];

export function seriesRows(symbol: string, spec: SeriesSpec, data: Array<Record<string, unknown>>): MetricRow[] {
  return data
    .map((r) => ({ symbol, ts: Math.floor(Number(r.timestamp) / FIVE_MIN) * FIVE_MIN, ...spec.map(r) }))
    .filter((r) => Number.isFinite(r.ts));
}

export function premiumRows(data: Array<Record<string, unknown>>, symbols: Set<string>): MetricRow[] {
  return data
    .filter((r) => symbols.has(String(r.symbol)))
    .map((r) => ({
      symbol: String(r.symbol),
      ts: Math.floor(Number(r.time) / FIVE_MIN) * FIVE_MIN,
      mark_price: num(r.markPrice),
      index_price: num(r.indexPrice),
      funding_rate: num(r.lastFundingRate),
    }));
}

export interface CollectorDeps {
  futures: AxiosInstance;
  futuresData: AxiosInstance;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: CollectorDeps = {
  futures: binanceFuturesClient,
  futuresData: binanceFuturesDataClient,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

export interface CollectOptions {
  symbols?: string[];
  /** How many top perpetuals to track when `symbols` is not given */
  topCount?: number;
  fundingBackfillDays?: number;
  log?: (line: string) => void;
}

export interface CollectSummary {
  symbols: string[];
  metricRows: number;
  fundingRows: number;
  errors: string[];
}

async function seriesBounds(symbol: string, column: MetricColumn): Promise<{ first: number; last: number } | null> {
  const rows = await query<Array<{ a: number | null; b: number | null }>>(
    `SELECT MIN(ts) AS a, MAX(ts) AS b FROM market_metrics_5m WHERE symbol = ? AND ${column} IS NOT NULL`,
    [symbol]
  );
  const r = rows[0];
  return r?.a == null || r.b == null ? null : { first: Number(r.a), last: Number(r.b) };
}

async function latestFunding(symbol: string): Promise<number | null> {
  const rows = await query<Array<{ t: number | null }>>("SELECT MAX(funding_time) AS t FROM funding_rates WHERE symbol = ?", [symbol]);
  return rows[0]?.t == null ? null : Number(rows[0].t);
}

export async function collectMarketData(options: CollectOptions = {}, deps: CollectorDeps = defaultDeps): Promise<CollectSummary> {
  const log = options.log ?? (() => undefined);
  await ensureMarketTables();
  const errors: string[] = [];
  const now = deps.now();

  let symbols = options.symbols;
  if (!symbols?.length) {
    const { data } = await deps.futures.get<Array<{ symbol: string; quoteVolume: string }>>("/ticker/24hr");
    symbols = topSymbols(data, options.topCount ?? 40);
  }
  log(`монет: ${symbols.length}`);

  const { data: premium } = await deps.futures.get<Array<Record<string, unknown>>>("/premiumIndex");
  let metricRows = await upsertMetrics(premiumRows(premium, new Set(symbols)));
  let fundingRows = 0;

  for (const symbol of symbols) {
    for (const spec of SERIES) {
      try {
        // Resume from this series' last stored bar (with an overlap, so late revisions land), and
        // backfill whatever of Binance's 30 days is still missing before the first stored bar.
        const retentionStart = now - SERIES_RETENTION_MS + FIVE_MIN;
        const bounds = await seriesBounds(symbol, spec.column);
        const ranges: Array<[number, number]> = [];
        if (!bounds) {
          ranges.push([retentionStart, now]);
        } else {
          if (bounds.first > retentionStart + 12 * FIVE_MIN) ranges.push([retentionStart, bounds.first]);
          ranges.push([Math.max(retentionStart, bounds.last - 6 * FIVE_MIN), now]);
        }
        for (const [from, to] of ranges) {
          // Explicit windows: with startTime alone Binance ignores it and returns the latest page.
          for (let start = from; start < to; start += SERIES_PAGE * FIVE_MIN) {
            await deps.sleep(REQUEST_GAP_MS);
            const { data } = await deps.futuresData.get<Array<Record<string, unknown>>>(spec.path, {
              params: {
                symbol,
                period: "5m",
                limit: SERIES_PAGE,
                startTime: start,
                endTime: Math.min(start + SERIES_PAGE * FIVE_MIN - 1, to),
              },
            });
            metricRows += await upsertMetrics(seriesRows(symbol, spec, data));
          }
        }
      } catch (e) {
        errors.push(`${symbol} ${spec.path}: ${(e as Error).message}`);
      }
    }

    try {
      const lastFunding = await latestFunding(symbol);
      let start = lastFunding != null ? lastFunding + 1 : now - (options.fundingBackfillDays ?? 1095) * DAY;
      while (start < now) {
        await deps.sleep(REQUEST_GAP_MS);
        const { data } = await deps.futures.get<Array<Record<string, unknown>>>("/fundingRate", {
          params: { symbol, startTime: start, limit: 1000 },
        });
        const rows: FundingRow[] = data
          .map((r) => ({
            symbol,
            fundingTime: Number(r.fundingTime),
            rate: num(r.fundingRate) ?? NaN,
            markPrice: num(r.markPrice) ?? null,
          }))
          .filter((r) => Number.isFinite(r.fundingTime) && Number.isFinite(r.rate));
        fundingRows += await upsertFunding(rows);
        if (data.length < 1000 || !rows.length) break;
        start = rows[rows.length - 1].fundingTime + 1;
      }
    } catch (e) {
      errors.push(`${symbol} /fundingRate: ${(e as Error).message}`);
    }
  }

  log(`записано: ${metricRows} строк метрик, ${fundingRows} ставок финансирования${errors.length ? `, ошибок ${errors.length}` : ""}`);
  for (const e of errors.slice(0, 10)) log(`  ${e}`);
  return { symbols, metricRows, fundingRows, errors };
}

export interface MarketDataStatus {
  symbols: number;
  metricRows: number;
  metricsFrom: string | null;
  metricsTo: string | null;
  fundingRows: number;
  fundingFrom: string | null;
}

export async function marketDataStatus(): Promise<MarketDataStatus> {
  await ensureMarketTables();
  const iso = (t: number | null) => (t == null ? null : new Date(Number(t)).toISOString());
  const [m] = await query<Array<{ n: number; s: number; a: number | null; b: number | null }>>(
    "SELECT COUNT(*) AS n, COUNT(DISTINCT symbol) AS s, MIN(ts) AS a, MAX(ts) AS b FROM market_metrics_5m"
  );
  const [f] = await query<Array<{ n: number; a: number | null }>>("SELECT COUNT(*) AS n, MIN(funding_time) AS a FROM funding_rates");
  return {
    symbols: Number(m?.s ?? 0),
    metricRows: Number(m?.n ?? 0),
    metricsFrom: iso(m?.a ?? null),
    metricsTo: iso(m?.b ?? null),
    fundingRows: Number(f?.n ?? 0),
    fundingFrom: iso(f?.a ?? null),
  };
}
