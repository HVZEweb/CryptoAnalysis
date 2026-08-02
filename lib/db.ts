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

  if (!(await columnExists("users", "device_id"))) {
    await db.execute("ALTER TABLE users ADD COLUMN device_id CHAR(36) NULL");
  }
  if (!(await columnExists("users", "reset_token"))) {
    await db.execute("ALTER TABLE users ADD COLUMN reset_token CHAR(64) NULL");
  }
  if (!(await columnExists("users", "reset_expires_at"))) {
    await db.execute("ALTER TABLE users ADD COLUMN reset_expires_at BIGINT NULL");
  }

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
