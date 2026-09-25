/**
 * New-listings data in MySQL: one row per coin that appeared on OKX (live or backfilled), and the
 * hourly bars of its first 7 days.
 */

import { execute, query } from "@/lib/db";
import type { Candle } from "@/types";

let ready = false;

export async function ensureListingTables(): Promise<void> {
  if (ready) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS listing_coin (
      base VARCHAR(30) NOT NULL PRIMARY KEY,
      exchange VARCHAR(10) NOT NULL DEFAULT 'okx',
      list_time BIGINT NOT NULL,
      primary_inst VARCHAR(40) NOT NULL,
      has_spot TINYINT NOT NULL,
      has_swap TINYINT NOT NULL,
      markets VARCHAR(255) NOT NULL,
      source ENUM('backfill','live') NOT NULL,
      first_seen_at BIGINT NOT NULL,
      announcement_title VARCHAR(255) NULL,
      announcement_url VARCHAR(255) NULL,
      announced_at BIGINT NULL,
      profile JSON NULL,
      bars_complete TINYINT NOT NULL DEFAULT 0,
      notified_at BIGINT NULL,
      followup_at BIGINT NULL,
      INDEX idx_listing_time (list_time)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS listing_bars (
      base VARCHAR(30) NOT NULL,
      open_time BIGINT NOT NULL,
      open DOUBLE NOT NULL,
      high DOUBLE NOT NULL,
      low DOUBLE NOT NULL,
      close DOUBLE NOT NULL,
      quote_volume DOUBLE NULL,
      PRIMARY KEY (base, open_time)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS listing_announcement (
      url VARCHAR(255) NOT NULL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      published_at BIGINT NOT NULL,
      notified_at BIGINT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  ready = true;
}

export interface ListingRow {
  base: string;
  list_time: number;
  primary_inst: string;
  has_spot: number;
  has_swap: number;
  markets: string;
  source: "backfill" | "live";
  first_seen_at: number;
  announcement_title: string | null;
  announcement_url: string | null;
  announced_at: number | null;
  profile: Record<string, unknown> | null;
  bars_complete: number;
  notified_at: number | null;
  followup_at: number | null;
}

const num = (r: ListingRow): ListingRow => ({
  ...r,
  list_time: Number(r.list_time),
  first_seen_at: Number(r.first_seen_at),
  announced_at: r.announced_at == null ? null : Number(r.announced_at),
  notified_at: r.notified_at == null ? null : Number(r.notified_at),
  followup_at: r.followup_at == null ? null : Number(r.followup_at),
  profile: typeof r.profile === "string" ? JSON.parse(r.profile) : r.profile,
});

export async function knownBases(): Promise<Set<string>> {
  await ensureListingTables();
  return new Set((await query<Array<{ base: string }>>("SELECT base FROM listing_coin")).map((r) => r.base));
}

export async function insertListing(r: Omit<ListingRow, "bars_complete" | "notified_at" | "followup_at" | "profile"> & { profile?: object | null }): Promise<void> {
  await ensureListingTables();
  await execute(
    `INSERT IGNORE INTO listing_coin (base, list_time, primary_inst, has_spot, has_swap, markets, source, first_seen_at, announcement_title, announcement_url, announced_at, profile)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [r.base, r.list_time, r.primary_inst, r.has_spot, r.has_swap, r.markets, r.source, r.first_seen_at, r.announcement_title, r.announcement_url, r.announced_at, r.profile ? JSON.stringify(r.profile) : null]
  );
}

export async function updateListing(base: string, patch: Partial<Pick<ListingRow, "bars_complete" | "notified_at" | "followup_at">> & { profile?: object }): Promise<void> {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  if (!keys.length) return;
  await execute(`UPDATE listing_coin SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE base = ?`, [
    ...keys.map((k) => (k === "profile" ? JSON.stringify(patch.profile) : (patch[k] as number))),
    base,
  ]);
}

export async function listings(filter: { incompleteBars?: boolean; since?: number } = {}): Promise<ListingRow[]> {
  await ensureListingTables();
  const where: string[] = [];
  const params: number[] = [];
  if (filter.incompleteBars) where.push("bars_complete = 0");
  if (filter.since != null) (where.push("list_time >= ?"), params.push(filter.since));
  return (await query<ListingRow[]>(`SELECT * FROM listing_coin ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY list_time DESC`, params)).map(num);
}

export async function saveBars(base: string, bars: Candle[]): Promise<void> {
  for (const b of bars) {
    await execute(
      `INSERT INTO listing_bars (base, open_time, open, high, low, close, quote_volume) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE open = VALUES(open), high = VALUES(high), low = VALUES(low), close = VALUES(close), quote_volume = VALUES(quote_volume)`,
      [base, b.openTime, b.open, b.high, b.low, b.close, Number.isFinite(b.quoteVolume) ? b.quoteVolume : null]
    );
  }
}

export async function barsOf(bases: string[]): Promise<Map<string, Candle[]>> {
  await ensureListingTables();
  const out = new Map<string, Candle[]>(bases.map((b) => [b, []]));
  if (!bases.length) return out;
  const rows = await query<Array<{ base: string; open_time: number; open: number; high: number; low: number; close: number; quote_volume: number | null }>>(
    `SELECT * FROM listing_bars WHERE base IN (${bases.map(() => "?").join(",")}) ORDER BY open_time`,
    bases
  );
  for (const r of rows) {
    const t = Number(r.open_time);
    out.get(r.base)?.push({ openTime: t, closeTime: t + 3_600_000 - 1, open: +r.open, high: +r.high, low: +r.low, close: +r.close, volume: 0, quoteVolume: Number(r.quote_volume ?? NaN), trades: 0 });
  }
  return out;
}

export async function knownAnnouncements(): Promise<Set<string>> {
  await ensureListingTables();
  return new Set((await query<Array<{ url: string }>>("SELECT url FROM listing_announcement")).map((r) => r.url));
}

export async function saveAnnouncement(a: { url: string; title: string; publishedAt: number }, notifiedAt: number | null): Promise<void> {
  await execute("INSERT IGNORE INTO listing_announcement (url, title, published_at, notified_at) VALUES (?, ?, ?, ?)", [a.url, a.title.slice(0, 255), a.publishedAt, notifiedAt]);
}

/** Announcement whose title names the coin (e.g. "OKX to list perpetual futures for KII crypto"). */
export async function announcementFor(base: string, around: number): Promise<{ title: string; url: string; published_at: number } | null> {
  await ensureListingTables();
  const rows = await query<Array<{ title: string; url: string; published_at: number }>>(
    "SELECT title, url, published_at FROM listing_announcement WHERE published_at BETWEEN ? AND ? ORDER BY published_at DESC",
    [around - 30 * 86_400_000, around + 86_400_000]
  );
  const re = new RegExp(`(^|[^A-Z0-9])${base.replace(/[^A-Z0-9]/gi, "")}([^A-Z0-9]|$)`, "i");
  const hit = rows.find((r) => re.test(r.title));
  return hit ? { ...hit, published_at: Number(hit.published_at) } : null;
}
