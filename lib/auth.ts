import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { PoolConnection } from "mysql2/promise";
import { execute, query, withTransaction } from "@/lib/db";
import { getQuotaLimit, type UserTier } from "@/lib/quota-config";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  tier: UserTier;
  predictionsUsed: number;
  deviceId?: string;
  createdAt: string;
}

interface DbUserRow {
  id: string;
  email: string;
  password_hash: string;
  tier: "registered" | "paid";
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

export async function registerUser(
  email: string,
  password: string,
  deviceId?: string
): Promise<{ user: UserRecord; token: string }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@") || password.length < 8) {
    throw new Error("Некорректный email или пароль (мин. 8 символов)");
  }

  const existing = await findUserByEmail(normalized);
  if (existing) throw new Error("Пользователь с таким email уже существует");

  const deviceUsed = deviceId ? await getDeviceUsage(deviceId) : 0;
  const id = randomBytes(12).toString("hex");

  await execute(
    `INSERT INTO users (id, email, password_hash, tier, predictions_used, device_id)
     VALUES (?, ?, ?, 'registered', ?, ?)`,
    [id, normalized, hashPassword(password), deviceUsed, deviceId ?? null]
  );

  const user = await findUserById(id);
  if (!user) throw new Error("Ошибка создания пользователя");

  const token = await createSession(user.id);
  return { user, token };
}

export async function loginUser(
  email: string,
  password: string
): Promise<{ user: UserRecord; token: string }> {
  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new Error("Неверный email или пароль");
  }
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

export async function listUsers(limit = 100): Promise<
  Array<{ id: string; email: string; tier: string; predictionsUsed: number; deviceId: string | null; createdAt: string }>
> {
  const rows = await query<
    Array<{
      id: string;
      email: string;
      tier: string;
      predictions_used: number;
      device_id: string | null;
      created_at: Date;
    }>
  >("SELECT id, email, tier, predictions_used, device_id, created_at FROM users ORDER BY created_at DESC LIMIT ?", [
    limit,
  ]);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    tier: r.tier,
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
