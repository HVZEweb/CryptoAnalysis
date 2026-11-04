import { randomBytes } from "crypto";
import type { PoolConnection } from "mysql2/promise";
import { execute, query, withTransaction } from "@/lib/db";
import { getQuotaLimit, type UserTier } from "@/lib/quota-config";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { clearLoginFailures, loginWait, recordLoginFailure, waitMessage } from "@/lib/login-throttle";
import { createSession, revokeUserSessions, type ClientMeta } from "@/lib/sessions";
import { consumeToken, failTokenAttempt, issueToken, logAuthEvent, peekToken } from "@/lib/auth-tokens";
import { newRecoveryCodes, newTotpSecret, recoveryCodeHash, verifyTotp } from "@/lib/totp";

export { getUserIdBySession, deleteSession } from "@/lib/sessions";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  tier: UserTier;
  role: UserRole;
  predictionsUsed: number;
  deviceId?: string;
  /** End of the paid subscription (ms), if any */
  paidUntil: number | null;
  createdAt: string;
  emailVerifiedAt: number | null;
  /** Two-step sign-in is on (an authenticator app code after the password) */
  twoFactor: boolean;
  lastLoginAt: number | null;
}

/** Paid access: an admin, a permanent grant (tier = paid), or a subscription that has not ended. */
export function hasPaidAccess(u: Pick<UserRecord, "role" | "tier" | "paidUntil">, now = Date.now()): boolean {
  return u.role === "admin" || u.tier === "paid" || (u.paidUntil != null && u.paidUntil > now);
}

export type UserRole = "user" | "admin";

interface DbUserRow {
  id: string;
  email: string;
  password_hash: string;
  tier: "registered" | "paid";
  role?: UserRole;
  predictions_used: number;
  device_id: string | null;
  paid_until?: number | string | null;
  created_at: Date;
  email_verified_at?: number | string | null;
  totp_secret?: string | null;
  totp_enabled_at?: number | string | null;
  totp_last_step?: number | string | null;
  last_login_at?: number | string | null;
}

const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));

function mapUser(row: DbUserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    tier: row.tier,
    role: row.role === "admin" ? "admin" : "user",
    predictionsUsed: row.predictions_used,
    deviceId: row.device_id ?? undefined,
    paidUntil: num(row.paid_until),
    createdAt: row.created_at.toISOString(),
    emailVerifiedAt: num(row.email_verified_at),
    twoFactor: row.totp_enabled_at != null && !!row.totp_secret,
    lastLoginAt: num(row.last_login_at),
  };
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** A plausible address: something@domain.tld, no spaces, at most 254 characters. */
export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export async function getDeviceUsage(deviceId: string): Promise<number> {
  const rows = await query<Array<{ predictions_used: number }>>(
    "SELECT predictions_used FROM devices WHERE id = ? LIMIT 1",
    [deviceId]
  );
  return rows[0]?.predictions_used ?? 0;
}

async function userRow(where: "id" | "email", value: string): Promise<DbUserRow | null> {
  const rows = await query<DbUserRow[]>(`SELECT * FROM users WHERE ${where} = ? LIMIT 1`, [value]);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const row = await userRow("id", id);
  return row ? mapUser(row) : null;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const row = await userRow("email", normalizeEmail(email));
  return row ? mapUser(row) : null;
}

/** Emails listed in ADMIN_EMAILS (comma-separated) are always admins. */
function configuredAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * One login for everyone; the role decides what they can open. A user becomes admin when their
 * email is in ADMIN_EMAILS, or when they are the first account on a site that has no admin yet.
 */
async function ensureRole(user: UserRecord): Promise<UserRecord> {
  if (user.role === "admin") return user;
  let promote = configuredAdminEmails().includes(user.email);
  if (!promote) {
    const rows = await query<Array<{ c: number }>>("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
    promote = (rows[0]?.c ?? 0) === 0;
  }
  if (!promote) return user;
  await execute("UPDATE users SET role = 'admin' WHERE id = ?", [user.id]);
  return { ...user, role: "admin" };
}

/** SITE_PRIVATE=true: only signed-in users see the site; signup is closed once the first admin exists. */
export function isSitePrivate(): boolean {
  return process.env.SITE_PRIVATE?.trim() === "true";
}

export async function countUsers(): Promise<number> {
  const rows = await query<Array<{ c: number }>>("SELECT COUNT(*) AS c FROM users");
  return rows[0]?.c ?? 0;
}

/** Open signup on a public site; on a private one only for the very first account or with ALLOW_SIGNUP=true. */
export async function isSignupOpen(): Promise<boolean> {
  if (!isSitePrivate() || process.env.ALLOW_SIGNUP?.trim() === "true") return true;
  return (await countUsers()) === 0;
}

/** A sign-in or signup request that is refused with a message for the person. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

async function insertUser(email: string, password: string, deviceId?: string, role: UserRole = "user"): Promise<UserRecord> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) throw new AuthError("Некорректный email");
  const problem = passwordProblem(password, normalized);
  if (problem) throw new AuthError(problem);

  if (await userRow("email", normalized)) throw new AuthError("Аккаунт с таким email уже есть — войдите или восстановите пароль", 409);

  const deviceUsed = deviceId ? await getDeviceUsage(deviceId) : 0;
  const id = randomBytes(12).toString("hex");
  try {
    await execute(
      `INSERT INTO users (id, email, password_hash, tier, role, predictions_used, device_id, password_changed_at)
       VALUES (?, ?, ?, 'registered', ?, ?, ?, ?)`,
      [id, normalized, await hashPassword(password), role, deviceUsed, deviceId ?? null, Date.now()]
    );
  } catch (e) {
    // The same email registered at the same moment from another tab.
    if ((e as { errno?: number }).errno === 1062) throw new AuthError("Аккаунт с таким email уже есть — войдите или восстановите пароль", 409);
    throw e;
  }

  const created = await findUserById(id);
  if (!created) throw new Error("Ошибка создания пользователя");
  return ensureRole(created);
}

/** Self-service signup: the account and its first session. */
export async function registerUser(
  email: string,
  password: string,
  deviceId?: string,
  meta: ClientMeta = {}
): Promise<{ user: UserRecord; token: string; expiresAt: number }> {
  const user = await insertUser(email, password, deviceId);
  const { token, expiresAt } = await createSession(user.id, meta);
  await execute("UPDATE users SET last_login_at = ? WHERE id = ?", [Date.now(), user.id]);
  await logAuthEvent("register", { userId: user.id, email: user.email }, meta);
  return { user, token, expiresAt };
}

/** Account created by an admin (no session is started for it). */
export async function createUser(email: string, password: string, role: UserRole = "user"): Promise<UserRecord> {
  return insertUser(email, password, undefined, role);
}

export type PasswordCheck =
  | { status: "ok"; user: UserRecord }
  | { status: "invalid" }
  | { status: "locked"; waitMs: number };

/**
 * Checks an email and password. Unknown emails take as long as known ones, and five misses on one account make
 * it wait (lib/login-throttle.ts). Old-format hashes are upgraded on success.
 */
export async function checkPassword(email: string, password: string, meta: ClientMeta = {}): Promise<PasswordCheck> {
  const normalized = normalizeEmail(email);
  const waitMs = loginWait(normalized);
  if (waitMs > 0) return { status: "locked", waitMs };

  const row = isValidEmail(normalized) ? await userRow("email", normalized) : null;
  if (!row) {
    await burnPasswordCheck(password);
    recordLoginFailure(normalized);
    await logAuthEvent("login_failed", { email: normalized }, meta);
    return { status: "invalid" };
  }
  const { ok, needsRehash } = await verifyPassword(password, row.password_hash);
  if (!ok) {
    recordLoginFailure(normalized);
    await logAuthEvent("login_failed", { userId: row.id, email: normalized }, meta);
    return { status: "invalid" };
  }
  clearLoginFailures(normalized);
  if (needsRehash) await execute("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(password), row.id]);
  return { status: "ok", user: await ensureRole(mapUser(row)) };
}

/** Starts a session for a user who passed every step. */
export async function completeLogin(user: UserRecord, meta: ClientMeta = {}): Promise<{ token: string; expiresAt: number }> {
  const session = await createSession(user.id, meta);
  await execute("UPDATE users SET last_login_at = ? WHERE id = ?", [Date.now(), user.id]);
  await logAuthEvent("login", { userId: user.id, email: user.email }, meta);
  return session;
}

/** Password check, then either a session or — with two-step sign-in on — a 5-minute challenge for the code. */
export async function loginUser(
  email: string,
  password: string,
  meta: ClientMeta = {}
): Promise<{ user: UserRecord; token: string; expiresAt: number } | { twoFactor: string }> {
  const check = await checkPassword(email, password, meta);
  if (check.status === "locked") throw new AuthError(waitMessage(check.waitMs), 429);
  if (check.status === "invalid") throw new AuthError("Неверный email или пароль", 401);
  if (check.user.twoFactor) return { twoFactor: await issueToken(check.user.id, "login_2fa") };
  return { user: check.user, ...(await completeLogin(check.user, meta)) };
}

/** Second sign-in step: a code from the authenticator app or one of the recovery codes. */
export async function loginSecondStep(
  challenge: string,
  code: string,
  meta: ClientMeta = {}
): Promise<{ user: UserRecord; token: string; expiresAt: number }> {
  const pending = await peekToken(challenge, "login_2fa");
  if (!pending) throw new AuthError("Время на ввод кода вышло — войдите заново", 401);
  const row = await userRow("id", pending.userId);
  if (!row?.totp_secret || row.totp_enabled_at == null) throw new AuthError("Войдите заново", 401);

  const step = verifyTotp(row.totp_secret, code, num(row.totp_last_step));
  let usedRecovery = false;
  if (step == null) {
    usedRecovery = await spendRecoveryCode(row.id, code);
    if (!usedRecovery) {
      await failTokenAttempt(challenge);
      await logAuthEvent("login_2fa_failed", { userId: row.id, email: row.email }, meta);
      throw new AuthError("Неверный код", 401);
    }
  }
  if (!(await consumeToken(challenge, "login_2fa"))) throw new AuthError("Войдите заново", 401);
  // Remember the step only if it is later than the stored one (two sign-ins in one 30 s window).
  if (step != null) await execute("UPDATE users SET totp_last_step = GREATEST(COALESCE(totp_last_step, 0), ?) WHERE id = ?", [step, row.id]);
  if (usedRecovery) await logAuthEvent("recovery_code_used", { userId: row.id, email: row.email }, meta);
  const user = await ensureRole(mapUser(row));
  return { user, ...(await completeLogin(user, meta)) };
}

async function spendRecoveryCode(userId: string, code: string): Promise<boolean> {
  const r = await execute("UPDATE user_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL", [
    Date.now(),
    userId,
    recoveryCodeHash(code),
  ]);
  return r.affectedRows > 0;
}

/** Sets a new password and signs out every other session (all of them when exceptSessionId is not given). */
async function storePassword(userId: string, email: string, password: string, exceptSessionId?: string): Promise<void> {
  const problem = passwordProblem(password, email);
  if (problem) throw new AuthError(problem);
  await execute("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?", [await hashPassword(password), Date.now(), userId]);
  await revokeUserSessions(userId, exceptSessionId);
  await execute("DELETE FROM auth_tokens WHERE user_id = ? AND purpose IN ('reset_password', 'login_2fa')", [userId]);
}

/** Password change by the signed-in user: the current password is required; other devices are signed out. */
export async function changePassword(userId: string, current: string, next: string, sessionId: string, meta: ClientMeta = {}): Promise<void> {
  const row = await userRow("id", userId);
  if (!row) throw new AuthError("Аккаунт не найден", 404);
  if (!(await verifyPassword(current, row.password_hash)).ok) throw new AuthError("Текущий пароль неверный", 403);
  if (current === next) throw new AuthError("Новый пароль совпадает с текущим");
  await storePassword(userId, row.email, next, sessionId);
  await logAuthEvent("password_changed", { userId, email: row.email }, meta);
}

/** A reset link for an existing account (null for an unknown email — the caller answers the same either way). */
export async function createPasswordResetToken(email: string): Promise<{ token: string; user: UserRecord } | null> {
  const row = await userRow("email", normalizeEmail(email));
  if (!row) return null;
  return { token: await issueToken(row.id, "reset_password"), user: mapUser(row) };
}

/** Password reset from the emailed link: signs out everywhere, and the click confirms the email too. */
export async function resetPasswordWithToken(token: string, newPassword: string, meta: ClientMeta = {}): Promise<boolean> {
  const pending = await peekToken(token, "reset_password");
  if (!pending) return false;
  const row = await userRow("id", pending.userId);
  if (!row) return false;
  const problem = passwordProblem(newPassword, row.email);
  if (problem) throw new AuthError(problem);
  if (!(await consumeToken(token, "reset_password"))) return false;
  await storePassword(row.id, row.email, newPassword);
  await execute("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?", [Date.now(), row.id]);
  clearLoginFailures(row.email);
  await logAuthEvent("password_reset", { userId: row.id, email: row.email }, meta);
  return true;
}

export async function createEmailVerifyToken(userId: string): Promise<string> {
  return issueToken(userId, "verify_email");
}

/** Confirms the email from the emailed link; the user it belonged to, or null. */
export async function verifyEmailWithToken(token: string, meta: ClientMeta = {}): Promise<UserRecord | null> {
  const userId = await consumeToken(token, "verify_email");
  if (!userId) return null;
  await execute("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?", [Date.now(), userId]);
  const user = await findUserById(userId);
  if (user) await logAuthEvent("email_verified", { userId, email: user.email }, meta);
  return user;
}

/** Step 1 of turning on two-step sign-in: a new secret, stored but not active until a code confirms it. */
export async function startTwoFactorSetup(userId: string): Promise<string> {
  const row = await userRow("id", userId);
  if (!row) throw new AuthError("Аккаунт не найден", 404);
  if (row.totp_enabled_at != null) throw new AuthError("Двухэтапный вход уже включён");
  const secret = newTotpSecret();
  await execute("UPDATE users SET totp_secret = ?, totp_last_step = NULL WHERE id = ?", [secret, userId]);
  return secret;
}

/** Step 2: the first code from the app turns it on; returns the recovery codes (shown once). */
export async function enableTwoFactor(userId: string, code: string, meta: ClientMeta = {}): Promise<string[]> {
  const row = await userRow("id", userId);
  if (!row?.totp_secret) throw new AuthError("Сначала отсканируйте QR-код");
  if (row.totp_enabled_at != null) throw new AuthError("Двухэтапный вход уже включён");
  const step = verifyTotp(row.totp_secret, code, null);
  if (step == null) throw new AuthError("Код не подошёл. Проверьте время на телефоне и введите новый код.");
  await execute("UPDATE users SET totp_enabled_at = ?, totp_last_step = ? WHERE id = ?", [Date.now(), step, userId]);
  const codes = await replaceRecoveryCodes(userId);
  await logAuthEvent("2fa_enabled", { userId, email: row.email }, meta);
  return codes;
}

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await execute("DELETE FROM user_recovery_codes WHERE user_id = ?", [userId]);
  for (const c of codes) await execute("INSERT INTO user_recovery_codes (code_hash, user_id) VALUES (?, ?)", [recoveryCodeHash(c), userId]);
  return codes;
}

/** Needs the password and a current code (or a recovery code), so a stolen session alone cannot do it. */
async function confirmWithPasswordAndCode(userId: string, password: string, code: string): Promise<DbUserRow> {
  const row = await userRow("id", userId);
  if (!row?.totp_secret || row.totp_enabled_at == null) throw new AuthError("Двухэтапный вход не включён");
  if (!(await verifyPassword(password, row.password_hash)).ok) throw new AuthError("Пароль неверный", 403);
  const step = verifyTotp(row.totp_secret, code, num(row.totp_last_step));
  if (step != null) await execute("UPDATE users SET totp_last_step = ? WHERE id = ?", [step, userId]);
  else if (!(await spendRecoveryCode(userId, code))) throw new AuthError("Неверный код", 403);
  return row;
}

export async function disableTwoFactor(userId: string, password: string, code: string, meta: ClientMeta = {}): Promise<void> {
  const row = await confirmWithPasswordAndCode(userId, password, code);
  await resetTwoFactor(userId);
  await logAuthEvent("2fa_disabled", { userId, email: row.email }, meta);
}

export async function regenerateRecoveryCodes(userId: string, password: string, code: string): Promise<string[]> {
  await confirmWithPasswordAndCode(userId, password, code);
  return replaceRecoveryCodes(userId);
}

export async function recoveryCodesLeft(userId: string): Promise<number> {
  const rows = await query<Array<{ c: number }>>("SELECT COUNT(*) AS c FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL", [userId]);
  return Number(rows[0]?.c ?? 0);
}

/** Turns two-step sign-in off without a code — for an admin helping someone who lost their phone. */
export async function resetTwoFactor(userId: string): Promise<boolean> {
  const r = await execute("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?", [userId]);
  await execute("DELETE FROM user_recovery_codes WHERE user_id = ?", [userId]);
  return r.affectedRows > 0;
}

export async function setUserTier(email: string, tier: "registered" | "paid"): Promise<boolean> {
  const result = await execute("UPDATE users SET tier = ? WHERE email = ?", [tier, normalizeEmail(email)]);
  return result.affectedRows > 0;
}

export async function setUserTierById(id: string, tier: "registered" | "paid"): Promise<boolean> {
  const result = await execute("UPDATE users SET tier = ? WHERE id = ?", [tier, id]);
  return result.affectedRows > 0;
}

/** Admin-set password; also signs the user out everywhere. */
export async function setUserPassword(id: string, password: string): Promise<boolean> {
  const row = await userRow("id", id);
  if (!row) return false;
  await storePassword(id, row.email, password);
  clearLoginFailures(row.email);
  return true;
}

/** Changes a role; refuses to remove the last admin so the site can't lock itself out. */
export async function setUserRole(id: string, role: UserRole): Promise<"ok" | "not_found" | "last_admin"> {
  if (role === "user") {
    const rows = await query<Array<{ c: number }>>("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND id <> ?", [id]);
    if ((rows[0]?.c ?? 0) === 0) return "last_admin";
  }
  const result = await execute("UPDATE users SET role = ? WHERE id = ?", [role, id]);
  return result.affectedRows > 0 ? "ok" : "not_found";
}

export async function listUsers(limit = 100): Promise<
  Array<{
    id: string;
    email: string;
    tier: string;
    role: UserRole;
    predictionsUsed: number;
    deviceId: string | null;
    paidUntil: number | null;
    createdAt: string;
    emailVerified: boolean;
    twoFactor: boolean;
    lastLoginAt: number | null;
    sessions: number;
  }>
> {
  const rows = await query<
    Array<{
      id: string;
      email: string;
      tier: string;
      role: UserRole;
      predictions_used: number;
      device_id: string | null;
      paid_until: number | string | null;
      created_at: Date;
      email_verified_at: number | string | null;
      totp_enabled_at: number | string | null;
      last_login_at: number | string | null;
      sessions: number | string;
    }>
  >(
    `SELECT u.id, u.email, u.tier, u.role, u.predictions_used, u.device_id, u.paid_until, u.created_at,
            u.email_verified_at, u.totp_enabled_at, u.last_login_at,
            (SELECT COUNT(*) FROM user_sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS sessions
     FROM users u ORDER BY u.created_at DESC LIMIT ${Math.max(1, Math.min(1000, Math.floor(limit)))}`,
    [Date.now()]
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    tier: r.tier,
    role: r.role === "admin" ? "admin" : "user",
    predictionsUsed: r.predictions_used,
    deviceId: r.device_id,
    paidUntil: num(r.paid_until),
    createdAt: r.created_at.toISOString(),
    emailVerified: r.email_verified_at != null,
    twoFactor: r.totp_enabled_at != null,
    lastLoginAt: num(r.last_login_at),
    sessions: Number(r.sessions),
  }));
}

/** Adds days to a user's subscription by hand (e.g. a transfer with the wrong amount, checked manually). */
export async function extendSubscription(id: string, days: number, now = Date.now()): Promise<number | null> {
  const user = await findUserById(id);
  if (!user) return null;
  const until = Math.max(user.paidUntil ?? 0, now) + days * 86_400_000;
  await execute("UPDATE users SET paid_until = ? WHERE id = ?", [until, id]);
  return until;
}

async function reserveOnConnection(
  conn: PoolConnection,
  deviceId: string,
  userId: string | undefined,
  tier: UserTier
): Promise<boolean> {
  const limit = getQuotaLimit(tier);

  await conn.execute(
    "INSERT INTO devices (id, predictions_used) VALUES (?, 0) ON DUPLICATE KEY UPDATE id = id",
    [deviceId]
  );

  const [deviceRows] = await conn.execute(
    "SELECT predictions_used FROM devices WHERE id = ? FOR UPDATE",
    [deviceId]
  );
  const deviceUsed = (deviceRows as Array<{ predictions_used: number }>)[0]?.predictions_used ?? 0;

  if (!userId) {
    if (deviceUsed >= limit) return false;
    await conn.execute("UPDATE devices SET predictions_used = predictions_used + 1 WHERE id = ?", [deviceId]);
    return true;
  }

  const [userRows] = await conn.execute(
    "SELECT predictions_used, tier, role, paid_until FROM users WHERE id = ? FOR UPDATE",
    [userId]
  );
  const user = (userRows as Array<{ predictions_used: number; tier: string; role: string | null; paid_until: number | string | null }>)[0];
  if (!user) return false;

  const paid = hasPaidAccess({ role: user.role === "admin" ? "admin" : "user", tier: user.tier as UserTier, paidUntil: user.paid_until == null ? null : Number(user.paid_until) });
  const userLimit = paid ? getQuotaLimit("paid") : limit;
  if (user.predictions_used >= userLimit) return false;

  await conn.execute("UPDATE users SET predictions_used = predictions_used + 1 WHERE id = ?", [userId]);
  await conn.execute("UPDATE devices SET predictions_used = predictions_used + 1 WHERE id = ?", [deviceId]);
  return true;
}

async function refundOnConnection(
  conn: PoolConnection,
  deviceId: string,
  userId: string | undefined
): Promise<void> {
  await conn.execute(
    "UPDATE devices SET predictions_used = GREATEST(0, predictions_used - 1) WHERE id = ?",
    [deviceId]
  );
  if (userId) {
    await conn.execute(
      "UPDATE users SET predictions_used = GREATEST(0, predictions_used - 1) WHERE id = ?",
      [userId]
    );
  }
}

export async function reserveQuotaAtomic(
  deviceId: string,
  userId: string | undefined,
  tier: UserTier
): Promise<boolean> {
  return withTransaction((conn) => reserveOnConnection(conn, deviceId, userId, tier));
}

export async function refundQuotaAtomic(deviceId: string, userId: string | undefined): Promise<void> {
  return withTransaction((conn) => refundOnConnection(conn, deviceId, userId));
}

export async function getEffectiveUsage(
  deviceId: string,
  user: UserRecord | null | undefined
): Promise<number> {
  const deviceUsed = await getDeviceUsage(deviceId);
  if (!user) return deviceUsed;
  return Math.max(user.predictionsUsed, deviceUsed);
}
