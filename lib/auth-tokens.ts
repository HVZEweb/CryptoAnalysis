import { execute, query } from "@/lib/db";
import { newToken, tokenHash, type ClientMeta } from "@/lib/sessions";

/** One-time tokens: email confirmation links, password reset links and the second sign-in step. Stored by hash. */
export type TokenPurpose = "verify_email" | "reset_password" | "login_2fa";

export const TOKEN_TTL: Record<TokenPurpose, number> = {
  verify_email: 48 * 3_600_000,
  reset_password: 3_600_000,
  login_2fa: 5 * 60_000,
};

/** Wrong codes allowed for one second-step challenge before the password must be entered again. */
export const MAX_2FA_ATTEMPTS = 5;

/** A new token; earlier unused ones of the same purpose for this user stop working. */
export async function issueToken(userId: string, purpose: TokenPurpose, now = Date.now()): Promise<string> {
  const token = newToken();
  await execute("DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ?", [userId, purpose]);
  await execute("INSERT INTO auth_tokens (id, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)", [
    tokenHash(token),
    userId,
    purpose,
    now + TOKEN_TTL[purpose],
    now,
  ]);
  return token;
}

/** The user a live token belongs to, without using it up. */
export async function peekToken(token: string, purpose: TokenPurpose, now = Date.now()): Promise<{ userId: string; attempts: number } | null> {
  if (!token || token.length > 128) return null;
  const rows = await query<Array<{ user_id: string; attempts: number }>>(
    "SELECT user_id, attempts FROM auth_tokens WHERE id = ? AND purpose = ? AND expires_at > ? LIMIT 1",
    [tokenHash(token), purpose, now]
  );
  return rows[0] ? { userId: rows[0].user_id, attempts: rows[0].attempts } : null;
}

/** Uses a token up: the user it belonged to, or null if it was unknown, expired or already used. */
export async function consumeToken(token: string, purpose: TokenPurpose, now = Date.now()): Promise<string | null> {
  const found = await peekToken(token, purpose, now);
  if (!found) return null;
  // Only one request can delete the row, so a link clicked twice at once still works once.
  const r = await execute("DELETE FROM auth_tokens WHERE id = ? AND purpose = ?", [tokenHash(token), purpose]);
  return r.affectedRows > 0 ? found.userId : null;
}

/** Counts a wrong code; after MAX_2FA_ATTEMPTS the challenge is gone. */
export async function failTokenAttempt(token: string): Promise<void> {
  const id = tokenHash(token);
  await execute("UPDATE auth_tokens SET attempts = attempts + 1 WHERE id = ?", [id]);
  await execute("DELETE FROM auth_tokens WHERE id = ? AND attempts >= ?", [id, MAX_2FA_ATTEMPTS]);
}

export type AuthEventType =
  | "login"
  | "login_failed"
  | "login_2fa_failed"
  | "logout"
  | "register"
  | "password_changed"
  | "password_reset"
  | "reset_requested"
  | "email_verified"
  | "2fa_enabled"
  | "2fa_disabled"
  | "recovery_code_used"
  | "sessions_revoked";

export async function logAuthEvent(type: AuthEventType, who: { userId?: string | null; email?: string | null }, meta: ClientMeta = {}, now = Date.now()): Promise<void> {
  await execute("INSERT INTO auth_events (user_id, email, type, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    who.userId ?? null,
    who.email?.slice(0, 255) ?? null,
    type,
    meta.ip?.slice(0, 64) ?? null,
    meta.userAgent?.slice(0, 255) ?? null,
    now,
  ]).catch((e) => console.error("[auth-event]", (e as Error).message));
}

export async function recentAuthEvents(userId: string, limit = 15): Promise<Array<{ type: string; at: number; ip: string | null; userAgent: string | null }>> {
  const rows = await query<Array<{ type: string; created_at: number | string; ip: string | null; user_agent: string | null }>>(
    `SELECT type, created_at, ip, user_agent FROM auth_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(100, Math.floor(limit)))}`,
    [userId]
  );
  return rows.map((r) => ({ type: r.type, at: Number(r.created_at), ip: r.ip, userAgent: r.user_agent }));
}
