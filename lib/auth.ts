import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { PoolConnection } from "mysql2/promise";
import { execute, query, withTransaction } from "@/lib/db";
import { getQuotaLimit, type UserTier } from "@/lib/quota-config";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  tier: UserTier;
  role: UserRole;
  predictionsUsed: number;
  deviceId?: string;
  createdAt: string;
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
  created_at: Date;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

function mapUser(row: DbUserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    tier: row.tier,
    role: row.role === "admin" ? "admin" : "user",
    predictionsUsed: row.predictions_used,
    deviceId: row.device_id ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const hashBuffer = Buffer.from(hash, "hex");
    const derived = scryptSync(password, salt, 64);
    if (hashBuffer.length !== derived.length) return false;
    return timingSafeEqual(hashBuffer, derived);
  } catch {
    return false;
  }
}

function createToken(): string {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}

export async function getDeviceUsage(deviceId: string): Promise<number> {
  const rows = await query<Array<{ predictions_used: number }>>(
    "SELECT predictions_used FROM devices WHERE id = ? LIMIT 1",
    [deviceId]
  );
  return rows[0]?.predictions_used ?? 0;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const rows = await query<DbUserRow[]>("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const rows = await query<DbUserRow[]>("SELECT * FROM users WHERE email = ? LIMIT 1", [
    email.trim().toLowerCase(),
  ]);
  return rows[0] ? mapUser(rows[0]) : null;
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

async function insertUser(email: string, password: string, deviceId?: string, role: UserRole = "user"): Promise<UserRecord> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@") || password.length < 8) {
    throw new Error("Некорректный email или пароль (мин. 8 символов)");
  }

  const existing = await findUserByEmail(normalized);
  if (existing) throw new Error("Пользователь с таким email уже существует");

  const deviceUsed = deviceId ? await getDeviceUsage(deviceId) : 0;
  const id = randomBytes(12).toString("hex");

  await execute(
    `INSERT INTO users (id, email, password_hash, tier, role, predictions_used, device_id)
     VALUES (?, ?, ?, 'registered', ?, ?, ?)`,
    [id, normalized, hashPassword(password), role, deviceUsed, deviceId ?? null]
  );

  const created = await findUserById(id);
  if (!created) throw new Error("Ошибка создания пользователя");
  return ensureRole(created);
}

export async function registerUser(
  email: string,
  password: string,
  deviceId?: string
): Promise<{ user: UserRecord; token: string }> {
  const user = await insertUser(email, password, deviceId);
  const token = await createSession(user.id);
  return { user, token };
}

/** Account created by an admin (no session is started for it). */
export async function createUser(email: string, password: string, role: UserRole = "user"): Promise<UserRecord> {
  return insertUser(email, password, undefined, role);
}

export async function loginUser(
  email: string,
  password: string
): Promise<{ user: UserRecord; token: string }> {
  const found = await findUserByEmail(email);
  if (!found || !verifyPassword(password, found.passwordHash)) {
    throw new Error("Неверный email или пароль");
  }
  const user = await ensureRole(found);
  const token = await createSession(user.id);
  return { user, token };
}

async function createSession(userId: string): Promise<string> {
  const token = createToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await execute("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", [
    token,
    userId,
    expiresAt,
  ]);
  return token;
}

export async function getUserIdBySession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const rows = await query<Array<{ user_id: string }>>(
    "SELECT user_id FROM sessions WHERE token = ? AND expires_at > ? LIMIT 1",
    [token, Date.now()]
  );
  return rows[0]?.user_id ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await execute("DELETE FROM sessions WHERE token = ?", [token]);
}

export async function cleanupExpiredSessions(): Promise<void> {
  await execute("DELETE FROM sessions WHERE expires_at <= ?", [Date.now()]);
}

export async function createPasswordResetToken(email: string): Promise<string | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const token = createToken();
  await execute("UPDATE users SET reset_token = ?, reset_expires_at = ? WHERE id = ?", [
    token,
    Date.now() + RESET_TTL_MS,
    user.id,
  ]);
  return token;
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<boolean> {
  if (newPassword.length < 8) throw new Error("Пароль должен быть не короче 8 символов");
  const rows = await query<Array<{ id: string }>>(
    "SELECT id FROM users WHERE reset_token = ? AND reset_expires_at > ? LIMIT 1",
    [token, Date.now()]
  );
  if (!rows[0]) return false;
  await execute(
    "UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires_at = NULL WHERE id = ?",
    [hashPassword(newPassword), rows[0].id]
  );
  return true;
}

export async function setUserTier(email: string, tier: "registered" | "paid"): Promise<boolean> {
  const result = await execute("UPDATE users SET tier = ? WHERE email = ?", [
    tier,
    email.trim().toLowerCase(),
  ]);
  return result.affectedRows > 0;
}

export async function setUserTierById(id: string, tier: "registered" | "paid"): Promise<boolean> {
  const result = await execute("UPDATE users SET tier = ? WHERE id = ?", [tier, id]);
  return result.affectedRows > 0;
}

/** Admin-set password; also signs the user out everywhere. */
export async function setUserPassword(id: string, password: string): Promise<boolean> {
  if (password.length < 8) throw new Error("Пароль — минимум 8 символов");
  const result = await execute("UPDATE users SET password_hash = ? WHERE id = ?", [hashPassword(password), id]);
  if (result.affectedRows > 0) await execute("DELETE FROM sessions WHERE user_id = ?", [id]);
  return result.affectedRows > 0;
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
    createdAt: string;
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
      created_at: Date;
    }>
  >("SELECT id, email, tier, role, predictions_used, device_id, created_at FROM users ORDER BY created_at DESC LIMIT ?", [
    limit,
  ]);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    tier: r.tier,
    role: r.role === "admin" ? "admin" : "user",
    predictionsUsed: r.predictions_used,
    deviceId: r.device_id,
    createdAt: r.created_at.toISOString(),
  }));
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
    "SELECT predictions_used, tier FROM users WHERE id = ? FOR UPDATE",
    [userId]
  );
  const user = (userRows as Array<{ predictions_used: number; tier: string }>)[0];
  if (!user) return false;

  const userLimit = user.tier === "paid" ? getQuotaLimit("paid") : limit;
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
