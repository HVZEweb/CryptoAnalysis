import mysql, { type PoolConnection, type ResultSetHeader } from "mysql2/promise";

export type SqlParam = string | number | boolean | null | Date | Buffer;

const DB_NAME = process.env.DB_NAME ?? "crypto_predictor";

let pool: mysql.Pool | null = null;
let schemaReady = false;
let schemaInitPromise: Promise<void> | null = null;

function getConfig() {
  return {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: DB_NAME,
  };
}

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      ...getConfig(),
      waitForConnections: true,
      connectionLimit: 10,
      charset: "utf8mb4",
    });
  }
  return pool;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await getPool().execute(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, table, column]
  );
  return ((rows as Array<{ c: number }>)[0]?.c ?? 0) > 0;
}

async function initializeSchema(): Promise<void> {
  const { host, port, user, password } = getConfig();
  const bootstrap = await mysql.createConnection({ host, port, user, password });
  try {
    await bootstrap.execute(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await bootstrap.end();
  }

  const db = getPool();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id CHAR(24) PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      tier ENUM('registered', 'paid') NOT NULL DEFAULT 'registered',
      role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
      predictions_used INT NOT NULL DEFAULT 0,
      device_id CHAR(36) NULL,
      reset_token CHAR(64) NULL,
      reset_expires_at BIGINT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_users_device (device_id),
      INDEX idx_users_reset (reset_token)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      token CHAR(64) PRIMARY KEY,
      user_id CHAR(24) NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sessions_user (user_id),
      INDEX idx_sessions_expires (expires_at),
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS devices (
      id CHAR(36) PRIMARY KEY,
      predictions_used INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS predictions (
      id CHAR(24) PRIMARY KEY,
      user_id CHAR(24) NULL,
      device_id CHAR(36) NULL,
      symbol VARCHAR(20) NOT NULL,
      coin_name VARCHAR(120) NOT NULL,
      market ENUM('Spot', 'Futures') NOT NULL,
      timeframe VARCHAR(10) NOT NULL,
      direction ENUM('LONG', 'SHORT', 'SIDEWAYS') NOT NULL,
      probability INT NOT NULL,
      price_at_prediction DECIMAL(24, 12) NOT NULL,
      price_range_low DECIMAL(24, 12) NOT NULL,
      price_range_high DECIMAL(24, 12) NOT NULL,
      entry_price DECIMAL(24, 12) NULL,
      tp_price DECIMAL(24, 12) NULL,
      sl_price DECIMAL(24, 12) NULL,
      exit_price DECIMAL(24, 12) NULL,
      payload JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_predictions_user (user_id),
      INDEX idx_predictions_device (device_id),
      INDEX idx_predictions_created (created_at),
      CONSTRAINT fk_predictions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Another process (or test file) may add the same column at the same moment: "duplicate column" is fine.
  const addColumn = async (table: string, column: string, definition: string) => {
    if (await columnExists(table, column)) return;
    try {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (e) {
      if ((e as { errno?: number }).errno !== 1060) throw e;
    }
  };
  await addColumn("users", "device_id", "CHAR(36) NULL");
  await addColumn("users", "reset_token", "CHAR(64) NULL");
  await addColumn("users", "reset_expires_at", "BIGINT NULL");
  await addColumn("users", "role", "ENUM('user', 'admin') NOT NULL DEFAULT 'user'");
  // Paid subscription end (ms). tier = 'paid' stays a permanent grant made by hand.
  await addColumn("users", "paid_until", "BIGINT NULL");
  // Sign-in security (lib/sessions.ts, lib/auth-tokens.ts, lib/totp.ts); times in ms.
  await addColumn("users", "email_verified_at", "BIGINT NULL");
  await addColumn("users", "password_changed_at", "BIGINT NULL");
  await addColumn("users", "last_login_at", "BIGINT NULL");
  await addColumn("users", "totp_secret", "VARCHAR(64) NULL");
  await addColumn("users", "totp_enabled_at", "BIGINT NULL");
  await addColumn("users", "totp_last_step", "BIGINT NULL");

  // Sessions are kept by the SHA-256 of their token: a copy of the database does not let anyone sign in.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id CHAR(64) PRIMARY KEY,
      user_id CHAR(24) NOT NULL,
      created_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      ip VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      INDEX idx_user_sessions_user (user_id),
      INDEX idx_user_sessions_expires (expires_at),
      CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // One-time links and challenges (email check, password reset, second sign-in step), also by hash.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id CHAR(64) PRIMARY KEY,
      user_id CHAR(24) NOT NULL,
      purpose ENUM('verify_email', 'reset_password', 'login_2fa') NOT NULL,
      expires_at BIGINT NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      INDEX idx_auth_tokens_user (user_id, purpose),
      INDEX idx_auth_tokens_expires (expires_at),
      CONSTRAINT fk_auth_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_recovery_codes (
      code_hash CHAR(64) PRIMARY KEY,
      user_id CHAR(24) NOT NULL,
      used_at BIGINT NULL,
      INDEX idx_recovery_user (user_id),
      CONSTRAINT fk_recovery_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // Sign-ins, failures, password and 2FA changes: shown to the user on /account, kept 90 days.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS auth_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id CHAR(24) NULL,
      email VARCHAR(255) NULL,
      type VARCHAR(32) NOT NULL,
      ip VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_auth_events_user (user_id, created_at),
      INDEX idx_auth_events_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  schemaReady = true;
}

async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  if (!schemaInitPromise) {
    schemaInitPromise = initializeSchema().catch((err) => {
      schemaInitPromise = null;
      throw err;
    });
  }
  await schemaInitPromise;
}

export async function query<T>(sql: string, params: SqlParam[] = []): Promise<T> {
  await ensureSchema();
  const [rows] = await getPool().execute(sql, params);
  return rows as T;
}

export async function execute(sql: string, params: SqlParam[] = []): Promise<ResultSetHeader> {
  await ensureSchema();
  const [result] = await getPool().execute(sql, params);
  return result as ResultSetHeader;
}

export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  await ensureSchema();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
