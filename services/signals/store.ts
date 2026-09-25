/**
 * Telegram signals state in MySQL: each chat's watchlist and settings, and a log of every signal
 * sent with its real outcome — the live track record behind /stats and the auto-disable rule.
 */

import { execute, query } from "@/lib/db";

let ready = false;

export async function ensureSignalTables(): Promise<void> {
  if (ready) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS signal_watch (
      chat_id VARCHAR(32) NOT NULL,
      symbol VARCHAR(30) NOT NULL,
      added_at BIGINT NOT NULL,
      PRIMARY KEY (chat_id, symbol)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS signal_chat (
      chat_id VARCHAR(32) NOT NULL PRIMARY KEY,
      paused TINYINT NOT NULL DEFAULT 0,
      observe TINYINT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // News alerts (services/news-impact) are on unless the chat turns them off with /news off.
  await execute("ALTER TABLE signal_chat ADD COLUMN IF NOT EXISTS news TINYINT NOT NULL DEFAULT 1");
  await execute(`
    CREATE TABLE IF NOT EXISTS signal_log (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      chat_id VARCHAR(32) NOT NULL,
      model_key VARCHAR(40) NOT NULL,
      model_trained_at VARCHAR(40) NOT NULL,
      symbol VARCHAR(30) NOT NULL,
      timeframe VARCHAR(10) NOT NULL,
      bar_interval VARCHAR(10) NOT NULL,
      side ENUM('LONG','SHORT') NOT NULL,
      entry DOUBLE NOT NULL,
      tp DOUBLE NOT NULL,
      sl DOUBLE NOT NULL,
      entry_time BIGINT NOT NULL,
      close_by BIGINT NOT NULL,
      sent_at BIGINT NOT NULL,
      status ENUM('open','tp','sl','timeout') NOT NULL DEFAULT 'open',
      exit_price DOUBLE NULL,
      gross_bp DOUBLE NULL,
      net_bp DOUBLE NULL,
      closed_at BIGINT NULL,
      INDEX idx_signal_open (status, chat_id),
      INDEX idx_signal_model (model_key, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // OKX demo execution of the signal (lib/okx-demo): what really filled next to the calculated result.
  for (const col of [
    "demo_status ENUM('open','closing','closed','failed') NULL",
    "demo_inst_id VARCHAR(40) NULL",
    "demo_entry DOUBLE NULL",
    "demo_exit DOUBLE NULL",
    "demo_net_bp DOUBLE NULL",
    "demo_note VARCHAR(255) NULL",
  ]) {
    await execute(`ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS ${col}`);
  }
  await execute(`
    CREATE TABLE IF NOT EXISTS signal_model_state (
      model_key VARCHAR(40) NOT NULL PRIMARY KEY,
      disabled_trained_at VARCHAR(40) NULL,
      reason VARCHAR(255) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  ready = true;
}

export interface ChatSettings {
  paused: boolean;
  observe: boolean;
  news: boolean;
}

export async function getChat(chatId: string): Promise<ChatSettings> {
  await ensureSignalTables();
  const [row] = await query<Array<{ paused: number; observe: number; news: number }>>(
    "SELECT paused, observe, news FROM signal_chat WHERE chat_id = ?",
    [chatId]
  );
  return { paused: Boolean(row?.paused), observe: Boolean(row?.observe), news: row ? Boolean(row.news) : true };
}

export async function setChat(chatId: string, patch: Partial<ChatSettings>): Promise<void> {
  const next = { ...(await getChat(chatId)), ...patch };
  await execute(
    `INSERT INTO signal_chat (chat_id, paused, observe, news) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE paused = VALUES(paused), observe = VALUES(observe), news = VALUES(news)`,
    [chatId, next.paused ? 1 : 0, next.observe ? 1 : 0, next.news ? 1 : 0]
  );
}

export async function getWatchlist(chatId: string): Promise<string[]> {
  await ensureSignalTables();
  const rows = await query<Array<{ symbol: string }>>("SELECT symbol FROM signal_watch WHERE chat_id = ? ORDER BY added_at, symbol", [chatId]);
  return rows.map((r) => r.symbol);
}

/** Every watched symbol of every chat — the collector keeps positioning data for these too. */
export async function allWatchedSymbols(): Promise<string[]> {
  await ensureSignalTables();
  const rows = await query<Array<{ symbol: string }>>("SELECT DISTINCT symbol FROM signal_watch");
  return rows.map((r) => r.symbol);
}

export async function addWatch(chatId: string, symbols: string[], now = Date.now()): Promise<void> {
  await ensureSignalTables();
  for (const s of symbols) {
    await execute("INSERT IGNORE INTO signal_watch (chat_id, symbol, added_at) VALUES (?, ?, ?)", [chatId, s, now]);
  }
}

export async function removeWatch(chatId: string, symbols: string[]): Promise<number> {
  await ensureSignalTables();
  let n = 0;
  for (const s of symbols) n += (await execute("DELETE FROM signal_watch WHERE chat_id = ? AND symbol = ?", [chatId, s])).affectedRows;
  return n;
}

export interface SignalRow {
  id: number;
  chat_id: string;
  model_key: string;
  model_trained_at: string;
  symbol: string;
  timeframe: string;
  bar_interval: string;
  side: "LONG" | "SHORT";
  entry: number;
  tp: number;
  sl: number;
  entry_time: number;
  close_by: number;
  sent_at: number;
  status: "open" | "tp" | "sl" | "timeout";
  exit_price: number | null;
  gross_bp: number | null;
  net_bp: number | null;
  closed_at: number | null;
  demo_status?: "open" | "closing" | "closed" | "failed" | null;
  demo_inst_id?: string | null;
  demo_entry?: number | null;
  demo_exit?: number | null;
  demo_net_bp?: number | null;
  demo_note?: string | null;
}

export type NewSignal = Omit<
  SignalRow,
  "id" | "status" | "exit_price" | "gross_bp" | "net_bp" | "closed_at" | "demo_status" | "demo_inst_id" | "demo_entry" | "demo_exit" | "demo_net_bp" | "demo_note"
>;

export type DemoPatch = Partial<Pick<SignalRow, "demo_status" | "demo_inst_id" | "demo_entry" | "demo_exit" | "demo_net_bp" | "demo_note">>;

export async function setDemo(id: number, patch: DemoPatch): Promise<void> {
  const keys = Object.keys(patch) as Array<keyof DemoPatch>;
  if (!keys.length) return;
  await execute(`UPDATE signal_log SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [
    ...keys.map((k) => {
      const v = patch[k];
      return typeof v === "string" ? v.slice(0, 255) : (v ?? null);
    }),
    id,
  ]);
}

/** Signals whose demo position is still open or waiting for OKX to report its result. */
export async function pendingDemo(): Promise<SignalRow[]> {
  await ensureSignalTables();
  return (await query<SignalRow[]>("SELECT * FROM signal_log WHERE demo_status IN ('open','closing') ORDER BY sent_at")).map(numeric);
}

export async function logSignal(s: NewSignal): Promise<number> {
  await ensureSignalTables();
  const r = await execute(
    `INSERT INTO signal_log (chat_id, model_key, model_trained_at, symbol, timeframe, bar_interval, side, entry, tp, sl, entry_time, close_by, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [s.chat_id, s.model_key, s.model_trained_at, s.symbol, s.timeframe, s.bar_interval, s.side, s.entry, s.tp, s.sl, s.entry_time, s.close_by, s.sent_at]
  );
  return r.insertId;
}

const numeric = (r: SignalRow): SignalRow => ({
  ...r,
  id: Number(r.id),
  entry: Number(r.entry),
  tp: Number(r.tp),
  sl: Number(r.sl),
  entry_time: Number(r.entry_time),
  close_by: Number(r.close_by),
  sent_at: Number(r.sent_at),
  exit_price: r.exit_price == null ? null : Number(r.exit_price),
  gross_bp: r.gross_bp == null ? null : Number(r.gross_bp),
  net_bp: r.net_bp == null ? null : Number(r.net_bp),
  closed_at: r.closed_at == null ? null : Number(r.closed_at),
  demo_entry: r.demo_entry == null ? null : Number(r.demo_entry),
  demo_exit: r.demo_exit == null ? null : Number(r.demo_exit),
  demo_net_bp: r.demo_net_bp == null ? null : Number(r.demo_net_bp),
});

export async function openSignals(): Promise<SignalRow[]> {
  await ensureSignalTables();
  return (await query<SignalRow[]>("SELECT * FROM signal_log WHERE status = 'open' ORDER BY sent_at")).map(numeric);
}

export async function closeSignal(
  id: number,
  outcome: { status: "tp" | "sl" | "timeout"; exitPrice: number; grossBp: number; netBp: number; closedAt: number }
): Promise<void> {
  await execute("UPDATE signal_log SET status = ?, exit_price = ?, gross_bp = ?, net_bp = ?, closed_at = ? WHERE id = ? AND status = 'open'", [
    outcome.status,
    outcome.exitPrice,
    outcome.grossBp,
    outcome.netBp,
    outcome.closedAt,
    id,
  ]);
}

export async function closedSignals(filter: { chatId?: string; modelKey?: string; trainedAt?: string } = {}): Promise<SignalRow[]> {
  await ensureSignalTables();
  const where = ["status <> 'open'"];
  const params: string[] = [];
  if (filter.chatId) (where.push("chat_id = ?"), params.push(filter.chatId));
  if (filter.modelKey) (where.push("model_key = ?"), params.push(filter.modelKey));
  if (filter.trainedAt) (where.push("model_trained_at = ?"), params.push(filter.trainedAt));
  return (await query<SignalRow[]>(`SELECT * FROM signal_log WHERE ${where.join(" AND ")} ORDER BY closed_at`, params)).map(numeric);
}

export async function disabledModels(): Promise<Map<string, { trainedAt: string; reason: string }>> {
  await ensureSignalTables();
  const rows = await query<Array<{ model_key: string; disabled_trained_at: string | null; reason: string | null }>>(
    "SELECT model_key, disabled_trained_at, reason FROM signal_model_state WHERE disabled_trained_at IS NOT NULL"
  );
  return new Map(rows.map((r) => [r.model_key, { trainedAt: r.disabled_trained_at!, reason: r.reason ?? "" }]));
}

export async function disableModel(modelKey: string, trainedAt: string, reason: string): Promise<void> {
  await ensureSignalTables();
  await execute(
    `INSERT INTO signal_model_state (model_key, disabled_trained_at, reason) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE disabled_trained_at = VALUES(disabled_trained_at), reason = VALUES(reason)`,
    [modelKey, trainedAt, reason.slice(0, 255)]
  );
}
