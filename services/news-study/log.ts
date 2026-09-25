/**
 * Live side of the news study: every headline the news monitor fetches is stored with its topic, and a day
 * later the real BTC (and coin) moves after it are filled in from Binance candles. The per-topic statistics
 * then back the news alerts ("such news before: BTC +0.4% in an hour, up 62% of the time").
 */

import type { Candle } from "@/types";
import { execute, query } from "@/lib/db";
import { fetchCandlesInRange } from "@/services/binance";
import { detectCoinsFromText, resolvePrimaryCoin } from "@/services/news-impact/coin-resolver";
import type { RawNewsSignal } from "@/services/news-impact/types";
import {
  HORIZONS,
  baselineOf,
  movesAfter,
  newsTopic,
  studyTopics,
  topicLabel,
  type HorizonKey,
  type NewsEvent,
  type TopicStats,
} from "@/services/news-study/study";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** Only news seen within this long of publication counts: a stale headline says nothing about the move after it. */
export const MAX_LAG_MS = 30 * 60_000;
const COLS = HORIZONS.map((h) => h.key);

let ready = false;

export async function ensureNewsLogTable(): Promise<void> {
  if (ready) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS news_log (
      id VARCHAR(40) NOT NULL PRIMARY KEY,
      published_at BIGINT NOT NULL,
      seen_at BIGINT NOT NULL,
      source VARCHAR(120) NOT NULL,
      title VARCHAR(500) NOT NULL,
      url VARCHAR(1000) NULL,
      topic VARCHAR(60) NULL,
      coin VARCHAR(20) NULL,
      ${COLS.map((c) => `btc_${c} DOUBLE NULL, coin_${c} DOUBLE NULL`).join(",\n      ")},
      outcome_done TINYINT NOT NULL DEFAULT 0,
      INDEX idx_news_log_topic (topic),
      INDEX idx_news_log_pending (outcome_done, published_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  ready = true;
}

/** Stores new headlines; ones already stored are skipped. Returns how many were new. */
export async function logNews(signals: RawNewsSignal[], now = Date.now()): Promise<number> {
  if (!signals.length) return 0;
  await ensureNewsLogTable();
  let added = 0;
  for (const s of signals) {
    const published = Date.parse(s.publishedAt);
    const text = `${s.title} ${s.summary ?? ""}`;
    const coin = resolvePrimaryCoin([...(s.hintCoins ?? []), ...detectCoinsFromText(text)]);
    const r = await execute(
      `INSERT IGNORE INTO news_log (id, published_at, seen_at, source, title, url, topic, coin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.id.slice(0, 40),
        Number.isFinite(published) ? Math.min(published, now) : now,
        now,
        s.source.slice(0, 120),
        s.title.slice(0, 500),
        s.url?.slice(0, 1000) ?? null,
        newsTopic(s.title, s.summary),
        coin,
      ]
    );
    added += r.affectedRows;
  }
  return added;
}

export interface FillDeps {
  candles: (symbol: string, from: number, to: number) => Promise<Candle[]>;
  now: () => number;
}

const defaultDeps: FillDeps = {
  candles: (symbol, from, to) => fetchCandlesInRange(symbol, "5m", "Futures", from, to),
  now: () => Date.now(),
};

/** Fills the moves of headlines older than a day. BTC candles are fetched once per run; coins per headline. */
export async function fillOutcomes(deps: FillDeps = defaultDeps, limit = 200): Promise<number> {
  await ensureNewsLogTable();
  const due = deps.now() - DAY - 15 * 60_000;
  const rows = await query<Array<{ id: string; published_at: number; coin: string | null }>>(
    // LIMIT as a literal: MySQL 8 rejects it as a prepared-statement parameter.
    `SELECT id, published_at, coin FROM news_log WHERE outcome_done = 0 AND published_at < ? ORDER BY published_at LIMIT ${Math.max(1, Math.floor(limit))}`,
    [due]
  );
  if (!rows.length) return 0;
  const first = Number(rows[0].published_at);
  const last = Number(rows.at(-1)!.published_at);
  const btc = await deps.candles("BTC", first - HOUR, last + DAY + HOUR);

  for (const r of rows) {
    const t = Number(r.published_at);
    const btcMoves = movesAfter(btc, t);
    let coinMoves: Partial<Record<HorizonKey, number>> = {};
    if (r.coin && r.coin !== "BTC") {
      coinMoves = await deps
        .candles(r.coin, t - HOUR, t + DAY + HOUR)
        .then((c) => movesAfter(c, t))
        .catch(() => ({}));
    }
    await execute(
      `UPDATE news_log SET ${COLS.map((c) => `btc_${c} = ?, coin_${c} = ?`).join(", ")}, outcome_done = 1 WHERE id = ?`,
      [...COLS.flatMap((c) => [btcMoves[c] ?? null, coinMoves[c] ?? null]), r.id]
    );
  }
  return rows.length;
}

let fillTimer: ReturnType<typeof setInterval> | null = null;

export function startNewsOutcomeJob(): void {
  if (fillTimer) return;
  const run = () => fillOutcomes().catch((e) => console.warn("[news-study] fill failed:", (e as Error).message));
  void run();
  fillTimer = setInterval(run, 15 * 60_000);
  fillTimer.unref?.();
}

type Row = { topic: string; published_at: number; seen_at: number; coin: string | null } & Record<string, number | null>;

export interface LiveStudy {
  since: number | null;
  logged: number;
  measured: number;
  topics: TopicStats[];
  /** The coin named in the headline, same horizons, raw moves (no baseline) */
  coinMoves: Record<string, { n: number; h1: number; upShare: number }>;
}

let cache: { at: number; value: LiveStudy } | null = null;

/** Per-topic statistics from the live log; cached for 30 minutes. */
export async function liveStudy(deps: Pick<FillDeps, "candles" | "now"> = defaultDeps): Promise<LiveStudy> {
  const now = deps.now();
  if (cache && now - cache.at < 30 * 60_000) return cache.value;
  await ensureNewsLogTable();
  const [counts] = await query<Array<{ n: number; since: number | null }>>("SELECT COUNT(*) AS n, MIN(published_at) AS since FROM news_log");
  const rows = await query<Row[]>(
    `SELECT topic, published_at, seen_at, coin, ${COLS.map((c) => `btc_${c}, coin_${c}`).join(", ")}
     FROM news_log WHERE outcome_done = 1 AND topic IS NOT NULL AND seen_at - published_at <= ?`,
    [MAX_LAG_MS]
  );
  const events: NewsEvent[] = rows.map((r) => ({
    topic: r.topic,
    time: Number(r.published_at),
    moves: Object.fromEntries(COLS.filter((c) => r[`btc_${c}`] != null).map((c) => [c, Number(r[`btc_${c}`])])),
  }));

  let topics: TopicStats[] = [];
  if (events.length) {
    // The usual move is measured over the last 90 days at most: enough for a stable baseline, light for the server.
    const from = Math.max(Math.min(...events.map((e) => e.time)), now - 90 * DAY);
    const btc = await deps.candles("BTC", from, now).catch(() => [] as Candle[]);
    topics = studyTopics(events, baselineOf(btc));
  }

  const coinMoves: LiveStudy["coinMoves"] = {};
  for (const r of rows) {
    const v = r.coin_h1;
    if (v == null || !r.coin || r.coin === "BTC") continue;
    const acc = (coinMoves[r.topic] ??= { n: 0, h1: 0, upShare: 0 });
    acc.h1 += Number(v);
    acc.upShare += Number(v) > 0 ? 1 : 0;
    acc.n++;
  }
  for (const acc of Object.values(coinMoves)) {
    acc.h1 /= acc.n;
    acc.upShare /= acc.n;
  }

  const value: LiveStudy = {
    since: counts?.since != null ? Number(counts.since) : null,
    logged: Number(counts?.n ?? 0),
    measured: rows.length,
    topics,
    coinMoves,
  };
  cache = { at: now, value };
  return value;
}

/** One line for a news alert: how BTC moved after earlier news of the same topic. */
export function similarNewsLine(study: LiveStudy, topic: string | null): string | null {
  if (!topic) return null;
  const s = study.topics.find((t) => t.topic === topic);
  const label = topicLabel(topic);
  if (!s || s.verdict === "few") {
    return `📊 Тема «${label}»: статистика ещё копится (${s?.events ?? 0} похожих новостей с известным исходом, нужно от 20).`;
  }
  const coin = study.coinMoves[topic];
  const coinPart =
    coin && coin.n >= 20
      ? ` Сама монета из новости через 1 ч: в среднем ${coin.h1 >= 0 ? "+" : ""}${coin.h1.toFixed(2)}%, вверх в ${Math.round(coin.upShare * 100)}% (${coin.n}).`
      : "";
  return `📊 Раньше после новостей «${label}» BTC: ${s.summary}.${coinPart}`;
}
