import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { execute, query } from "@/lib/db";
import { fetchMarketData } from "@/services/binance";
import type { NewsImpactPrediction, RawNewsSignal } from "@/services/news-impact/types";

const CACHE_DIR = path.join(process.cwd(), ".cache", "news-impact");
const HISTORY_JSONL = path.join(CACHE_DIR, "history.jsonl");
const OUTCOME_INTERVAL_MS = 10 * 60_000;

const CHECKPOINTS_MIN = [5, 15, 30, 60] as const;

export interface NewsImpactHistoryRow {
  id: string;
  newsId: string;
  coin: string;
  newsTitle: string;
  newsUrl: string | null;
  predictedDirection: string;
  impactScore: number;
  expectedMovePct: number;
  priceAtNews: number | null;
  actualMove5m: number | null;
  actualMove15m: number | null;
  actualMove30m: number | null;
  actualMove60m: number | null;
  actualDirection: string | null;
  outcomeComplete: boolean;
  createdAt: string;
  signalJson?: string;
}

export interface HistoryPerformanceSummary {
  total: number;
  withOutcome: number;
  directionHitRate: number;
  avgMove5m: number;
  avgMove15m: number;
  avgMove30m: number;
  avgMove60m: number;
  avgExpectedMove: number;
}

let tableReady = false;
let outcomeTimer: ReturnType<typeof setInterval> | null = null;

function rowId(prediction: NewsImpactPrediction, newsTitle: string): string {
  return createHash("sha256")
    .update(`${prediction.newsId}:${prediction.coin}:${newsTitle}`)
    .digest("hex")
    .slice(0, 20);
}

async function ensureHistoryTable(): Promise<boolean> {
  if (tableReady) return true;
  try {
    await execute(`
      CREATE TABLE IF NOT EXISTS news_impact_history (
        id VARCHAR(24) PRIMARY KEY,
        news_id VARCHAR(80) NOT NULL,
        coin VARCHAR(20) NOT NULL,
        news_title VARCHAR(500) NOT NULL,
        news_url VARCHAR(1000) NULL,
        predicted_direction ENUM('LONG','SHORT','SIDEWAYS') NOT NULL,
        impact_score INT NOT NULL,
        expected_move_pct DECIMAL(8,4) NOT NULL,
        price_at_news DECIMAL(24,12) NULL,
        actual_move_5m DECIMAL(8,4) NULL,
        actual_move_15m DECIMAL(8,4) NULL,
        actual_move_30m DECIMAL(8,4) NULL,
        actual_move_60m DECIMAL(8,4) NULL,
        actual_direction ENUM('LONG','SHORT','SIDEWAYS') NULL,
        outcome_complete TINYINT(1) NOT NULL DEFAULT 0,
        signal_json JSON NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_news_history_outcome (outcome_complete, created_at),
        INDEX idx_news_history_coin (coin, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    tableReady = true;
    return true;
  } catch {
    return false;
  }
}

async function appendJsonlFallback(record: NewsImpactHistoryRow): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.appendFile(HISTORY_JSONL, `${JSON.stringify(record)}\n`, "utf-8");
}

export async function saveImpactHistory(
  prediction: NewsImpactPrediction,
  signal: RawNewsSignal
): Promise<void> {
  if (prediction.isSecondary) return;

  let priceAtNews: number | null = null;
  try {
    const mkt = await fetchMarketData(prediction.coin, "Futures");
    priceAtNews = mkt.price;
  } catch {
    priceAtNews = null;
  }

  const id = rowId(prediction, signal.title);
  const record: NewsImpactHistoryRow = {
    id,
    newsId: prediction.newsId,
    coin: prediction.coin,
    newsTitle: signal.title.slice(0, 500),
    newsUrl: signal.url ?? prediction.sourceUrl ?? null,
    predictedDirection: prediction.direction,
    impactScore: prediction.impactScore,
    expectedMovePct: prediction.expectedMovePct,
    priceAtNews,
    actualMove5m: null,
    actualMove15m: null,
    actualMove30m: null,
    actualMove60m: null,
    actualDirection: null,
    outcomeComplete: false,
    createdAt: new Date().toISOString(),
    signalJson: JSON.stringify({ prediction, signal: { id: signal.id, title: signal.title, source: signal.source } }),
  };

  const dbOk = await ensureHistoryTable();
  if (dbOk) {
    try {
      await execute(
        `INSERT INTO news_impact_history (
          id, news_id, coin, news_title, news_url, predicted_direction,
          impact_score, expected_move_pct, price_at_news, signal_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE impact_score = VALUES(impact_score)`,
        [
          record.id,
          record.newsId,
          record.coin,
          record.newsTitle,
          record.newsUrl,
          record.predictedDirection,
          record.impactScore,
          record.expectedMovePct,
          record.priceAtNews,
          record.signalJson ?? "{}",
        ]
      );
      return;
    } catch {
      // fall through to jsonl
    }
  }

  await appendJsonlFallback(record);
}

function pctMove(from: number, to: number): number {
  if (from <= 0) return 0;
  return Math.round(((to - from) / from) * 10000) / 100;
}

function directionFromMove(pct: number): "LONG" | "SHORT" | "SIDEWAYS" {
  if (pct > 0.15) return "LONG";
  if (pct < -0.15) return "SHORT";
  return "SIDEWAYS";
}

function pickBestMove(row: NewsImpactHistoryRow): number | null {
  const moves = [row.actualMove60m, row.actualMove30m, row.actualMove15m, row.actualMove5m].filter(
    (v): v is number => v != null
  );
  if (moves.length === 0) return null;
  return moves.reduce((best, m) => (Math.abs(m) > Math.abs(best) ? m : best), moves[0]);
}

async function updateRowOutcomes(row: NewsImpactHistoryRow): Promise<NewsImpactHistoryRow> {
  if (!row.priceAtNews || row.priceAtNews <= 0) return row;

  const ageMin = (Date.now() - new Date(row.createdAt).getTime()) / 60_000;
  let priceNow: number;
  try {
    const mkt = await fetchMarketData(row.coin, "Futures");
    priceNow = mkt.price;
  } catch {
    return row;
  }

  const move = pctMove(row.priceAtNews, priceNow);
  const updated = { ...row };

  if (ageMin >= 5 && updated.actualMove5m == null) updated.actualMove5m = move;
  if (ageMin >= 15 && updated.actualMove15m == null) updated.actualMove15m = move;
  if (ageMin >= 30 && updated.actualMove30m == null) updated.actualMove30m = move;
  if (ageMin >= 60 && updated.actualMove60m == null) updated.actualMove60m = move;

  const best = pickBestMove(updated);
  if (best != null) updated.actualDirection = directionFromMove(best);
  updated.outcomeComplete = ageMin >= 60 && updated.actualMove60m != null;

  return updated;
}

async function persistRowUpdate(row: NewsImpactHistoryRow): Promise<void> {
  const dbOk = await ensureHistoryTable();
  if (dbOk) {
    try {
      await execute(
        `UPDATE news_impact_history SET
          actual_move_5m = ?, actual_move_15m = ?, actual_move_30m = ?, actual_move_60m = ?,
          actual_direction = ?, outcome_complete = ?
         WHERE id = ?`,
        [
          row.actualMove5m,
          row.actualMove15m,
          row.actualMove30m,
          row.actualMove60m,
          row.actualDirection,
          row.outcomeComplete ? 1 : 0,
          row.id,
        ]
      );
      return;
    } catch {
      // jsonl fallback update is best-effort only on read
    }
  }
}

async function loadPendingFromDb(limit = 40): Promise<NewsImpactHistoryRow[]> {
  const dbOk = await ensureHistoryTable();
  if (!dbOk) return loadPendingFromJsonl(limit);

  try {
    const rows = await query<
      Array<{
        id: string;
        news_id: string;
        coin: string;
        news_title: string;
        news_url: string | null;
        predicted_direction: string;
        impact_score: number;
        expected_move_pct: number;
        price_at_news: number | null;
        actual_move_5m: number | null;
        actual_move_15m: number | null;
        actual_move_30m: number | null;
        actual_move_60m: number | null;
        actual_direction: string | null;
        outcome_complete: number;
        created_at: Date;
      }>
    >(
      `SELECT id, news_id, coin, news_title, news_url, predicted_direction, impact_score,
              expected_move_pct, price_at_news, actual_move_5m, actual_move_15m,
              actual_move_30m, actual_move_60m, actual_direction, outcome_complete, created_at
       FROM news_impact_history
       WHERE outcome_complete = 0
       ORDER BY created_at ASC
       LIMIT ?`,
      [limit]
    );

    return rows.map((r) => ({
      id: r.id,
      newsId: r.news_id,
      coin: r.coin,
      newsTitle: r.news_title,
      newsUrl: r.news_url,
      predictedDirection: r.predicted_direction,
      impactScore: r.impact_score,
      expectedMovePct: Number(r.expected_move_pct),
      priceAtNews: r.price_at_news != null ? Number(r.price_at_news) : null,
      actualMove5m: r.actual_move_5m != null ? Number(r.actual_move_5m) : null,
      actualMove15m: r.actual_move_15m != null ? Number(r.actual_move_15m) : null,
      actualMove30m: r.actual_move_30m != null ? Number(r.actual_move_30m) : null,
      actualMove60m: r.actual_move_60m != null ? Number(r.actual_move_60m) : null,
      actualDirection: r.actual_direction,
      outcomeComplete: !!r.outcome_complete,
      createdAt: r.created_at.toISOString(),
    }));
  } catch {
    return loadPendingFromJsonl(limit);
  }
}

async function loadPendingFromJsonl(limit: number): Promise<NewsImpactHistoryRow[]> {
  try {
    const raw = await fs.readFile(HISTORY_JSONL, "utf-8");
    const rows = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as NewsImpactHistoryRow);
    return rows.filter((r) => !r.outcomeComplete).slice(-limit);
  } catch {
    return [];
  }
}

export async function processOutcomeQueue(): Promise<number> {
  const pending = await loadPendingFromDb(40);
  let updated = 0;

  for (const row of pending) {
    const next = await updateRowOutcomes(row);
    const changed =
      next.actualMove5m !== row.actualMove5m ||
      next.actualMove15m !== row.actualMove15m ||
      next.actualMove30m !== row.actualMove30m ||
      next.actualMove60m !== row.actualMove60m ||
      next.outcomeComplete !== row.outcomeComplete;

    if (changed) {
      await persistRowUpdate(next);
      if (!(await ensureHistoryTable())) {
        await appendJsonlFallback(next);
      }
      updated += 1;
    }
  }

  return updated;
}

export async function getRecentHistory(limit = 20): Promise<NewsImpactHistoryRow[]> {
  const dbOk = await ensureHistoryTable();
  if (dbOk) {
    try {
      const rows = await query<
        Array<{
          id: string;
          news_id: string;
          coin: string;
          news_title: string;
          news_url: string | null;
          predicted_direction: string;
          impact_score: number;
          expected_move_pct: number;
          price_at_news: number | null;
          actual_move_5m: number | null;
          actual_move_15m: number | null;
          actual_move_30m: number | null;
          actual_move_60m: number | null;
          actual_direction: string | null;
          outcome_complete: number;
          created_at: Date;
        }>
      >(
        `SELECT id, news_id, coin, news_title, news_url, predicted_direction, impact_score,
                expected_move_pct, price_at_news, actual_move_5m, actual_move_15m,
                actual_move_30m, actual_move_60m, actual_direction, outcome_complete, created_at
         FROM news_impact_history
         ORDER BY created_at DESC
         LIMIT ?`,
        [limit]
      );

      return rows.map((r) => ({
        id: r.id,
        newsId: r.news_id,
        coin: r.coin,
        newsTitle: r.news_title,
        newsUrl: r.news_url,
        predictedDirection: r.predicted_direction,
        impactScore: r.impact_score,
        expectedMovePct: Number(r.expected_move_pct),
        priceAtNews: r.price_at_news != null ? Number(r.price_at_news) : null,
        actualMove5m: r.actual_move_5m != null ? Number(r.actual_move_5m) : null,
        actualMove15m: r.actual_move_15m != null ? Number(r.actual_move_15m) : null,
        actualMove30m: r.actual_move_30m != null ? Number(r.actual_move_30m) : null,
        actualMove60m: r.actual_move_60m != null ? Number(r.actual_move_60m) : null,
        actualDirection: r.actual_direction,
        outcomeComplete: !!r.outcome_complete,
        createdAt: r.created_at.toISOString(),
      }));
    } catch {
      // jsonl fallback
    }
  }

  try {
    const raw = await fs.readFile(HISTORY_JSONL, "utf-8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as NewsImpactHistoryRow)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

export async function getHistoryPerformance(): Promise<HistoryPerformanceSummary> {
  const rows = await getRecentHistory(100);
  const withOutcome = rows.filter((r) => r.actualDirection != null);
  const hits = withOutcome.filter((r) => r.actualDirection === r.predictedDirection);

  const avg = (vals: number[]) =>
    vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : 0;

  return {
    total: rows.length,
    withOutcome: withOutcome.length,
    directionHitRate:
      withOutcome.length > 0 ? Math.round((hits.length / withOutcome.length) * 100) : 0,
    avgMove5m: avg(withOutcome.map((r) => r.actualMove5m).filter((v): v is number => v != null)),
    avgMove15m: avg(withOutcome.map((r) => r.actualMove15m).filter((v): v is number => v != null)),
    avgMove30m: avg(withOutcome.map((r) => r.actualMove30m).filter((v): v is number => v != null)),
    avgMove60m: avg(withOutcome.map((r) => r.actualMove60m).filter((v): v is number => v != null)),
    avgExpectedMove: avg(rows.map((r) => r.expectedMovePct)),
  };
}

export function startOutcomeTrackingJob(): void {
  if (outcomeTimer) return;
  void processOutcomeQueue();
  outcomeTimer = setInterval(() => {
    void processOutcomeQueue();
  }, OUTCOME_INTERVAL_MS);
}

export function stopOutcomeTrackingJob(): void {
  if (outcomeTimer) {
    clearInterval(outcomeTimer);
    outcomeTimer = null;
  }
}

export { CHECKPOINTS_MIN };

export interface NewsTrackRecord {
  /** Strong predictions whose 60-minute outcome is known */
  count: number;
  /** Share where price moved the predicted way within 60 minutes */
  hitRate: number;
  /** Average 60-minute move in the predicted direction, % */
  avgMovePct: number;
}

/** What strong (alert-grade) news predictions really did an hour later. */
export function strongNewsRecord(rows: NewsImpactHistoryRow[], minImpact = 75): NewsTrackRecord {
  const done = rows.filter(
    (r) =>
      r.impactScore >= minImpact &&
      r.actualMove60m != null &&
      (r.predictedDirection === "LONG" || r.predictedDirection === "SHORT")
  );
  const moves = done.map((r) => (r.predictedDirection === "LONG" ? 1 : -1) * (r.actualMove60m as number));
  return {
    count: done.length,
    hitRate: done.length ? moves.filter((m) => m > 0).length / done.length : 0,
    avgMovePct: done.length ? moves.reduce((a, b) => a + b, 0) / done.length : 0,
  };
}

export async function getStrongNewsRecord(): Promise<NewsTrackRecord> {
  return strongNewsRecord(await getRecentHistory(500));
}
