import { createHash, randomBytes } from "crypto";
import { execute, query } from "@/lib/db";

/**
 * Sign-in sessions. The browser holds a random 256-bit token; the database holds only its SHA-256, so a leaked
 * copy of the database signs nobody in. A session lives 30 days after the last visit and at most 90 days after
 * sign-in; activity is written at most once an hour.
 */
export const SESSION_IDLE_MS = 30 * 86_400_000;
export const SESSION_MAX_MS = 90 * 86_400_000;
const TOUCH_EVERY_MS = 3_600_000;

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

const clip = (s: string | undefined, n: number) => (s ? s.slice(0, n) : null);

export async function createSession(userId: string, meta: ClientMeta = {}, now = Date.now()): Promise<{ token: string; expiresAt: number }> {
  const token = newToken();
  const expiresAt = now + SESSION_IDLE_MS;
  await execute(
    "INSERT INTO user_sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [tokenHash(token), userId, now, now, expiresAt, clip(meta.ip, 64), clip(meta.userAgent, 255)]
  );
  return { token, expiresAt };
}

export interface SessionInfo {
  id: string;
  userId: string;
  expiresAt: number;
  /** The expiry moved forward on this request: the cookie should be sent again with the new lifetime */
  renewed: boolean;
}

/** The live session behind a token (extending it on activity), or null. */
export async function lookupSession(token: string | undefined, meta: ClientMeta = {}, now = Date.now()): Promise<SessionInfo | null> {
  if (!token || token.length > 128) return null;
  const id = tokenHash(token);
  const rows = await query<Array<{ user_id: string; created_at: number | string; last_seen_at: number | string; expires_at: number | string }>>(
    "SELECT user_id, created_at, last_seen_at, expires_at FROM user_sessions WHERE id = ? AND expires_at > ? LIMIT 1",
    [id, now]
  );
  const row = rows[0];
  if (!row) return null;
  let expiresAt = Number(row.expires_at);
  let renewed = false;
  if (now - Number(row.last_seen_at) >= TOUCH_EVERY_MS) {
    expiresAt = Math.min(Number(row.created_at) + SESSION_MAX_MS, now + SESSION_IDLE_MS);
    renewed = expiresAt > Number(row.expires_at);
    await execute("UPDATE user_sessions SET last_seen_at = ?, expires_at = ?, ip = COALESCE(?, ip), user_agent = COALESCE(?, user_agent) WHERE id = ?", [
      now,
      expiresAt,
      clip(meta.ip, 64),
      clip(meta.userAgent, 255),
      id,
    ]);
  }
  return { id, userId: row.user_id, expiresAt, renewed };
}

export async function getUserIdBySession(token: string | undefined): Promise<string | null> {
  return (await lookupSession(token))?.userId ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await execute("DELETE FROM user_sessions WHERE id = ?", [tokenHash(token)]);
}

/** Signs a user out everywhere, or everywhere but one session (the one changing the password). */
export async function revokeUserSessions(userId: string, exceptId?: string): Promise<number> {
  const r = exceptId
    ? await execute("DELETE FROM user_sessions WHERE user_id = ? AND id <> ?", [userId, exceptId])
    : await execute("DELETE FROM user_sessions WHERE user_id = ?", [userId]);
  return r.affectedRows;
}

export async function revokeSessionById(userId: string, id: string): Promise<boolean> {
  return (await execute("DELETE FROM user_sessions WHERE user_id = ? AND id = ?", [userId, id])).affectedRows > 0;
}

export interface SessionRow {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  ip: string | null;
  userAgent: string | null;
}

export async function listSessions(userId: string, now = Date.now()): Promise<SessionRow[]> {
  const rows = await query<Array<{ id: string; created_at: number | string; last_seen_at: number | string; expires_at: number | string; ip: string | null; user_agent: string | null }>>(
    "SELECT id, created_at, last_seen_at, expires_at, ip, user_agent FROM user_sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC LIMIT 50",
    [userId, now]
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: Number(r.created_at),
    lastSeenAt: Number(r.last_seen_at),
    expiresAt: Number(r.expires_at),
    ip: r.ip,
    userAgent: r.user_agent,
  }));
}

let lastCleanup = 0;

/** Drops expired sessions and one-time tokens, and sign-in history older than 90 days; at most once an hour. */
export async function cleanupAuth(now = Date.now()): Promise<void> {
  if (now - lastCleanup < 3_600_000) return;
  lastCleanup = now;
  await execute("DELETE FROM user_sessions WHERE expires_at <= ?", [now]);
  await execute("DELETE FROM auth_tokens WHERE expires_at <= ?", [now]);
  await execute("DELETE FROM auth_events WHERE created_at < ?", [now - 90 * 86_400_000]);
  // The first version's sessions (raw tokens) are no longer read.
  await execute("DELETE FROM sessions").catch(() => undefined);
}

/** "Chrome · Windows" from a user agent. */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "Неизвестное устройство";
  const browser = /YaBrowser/.test(ua)
    ? "Яндекс Браузер"
    : /Edg\//.test(ua)
      ? "Edge"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Браузер";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}
