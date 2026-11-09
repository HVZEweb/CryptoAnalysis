import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Runs only next to a throwaway *_ci database (as in CI); uses a database of its own.
const base = process.env.DB_NAME ?? "";
const NAME = `${base}_collation`;
const cfg = {
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
};

describe.runIf(base.endsWith("_ci"))("schema on a database restored from an older server", () => {
  let admin: mysql.Connection;

  beforeAll(async () => {
    admin = await mysql.createConnection(cfg);
    await admin.query(`DROP DATABASE IF EXISTS \`${NAME}\``);
    await admin.query(`CREATE DATABASE \`${NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    // users as the old server created it: a collation other than the server's utf8mb4 default.
    const [def] = await admin.query("SELECT @@collation_server AS c");
    const other = (def as Array<{ c: string }>)[0].c === "utf8mb4_bin" ? "utf8mb4_general_ci" : "utf8mb4_bin";
    await admin.query(`CREATE TABLE \`${NAME}\`.users (
      id CHAR(24) PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL,
      tier ENUM('registered', 'paid') NOT NULL DEFAULT 'registered', predictions_used INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${other}`);
  });

  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS \`${NAME}\``);
    await admin.end();
  });

  it("creates the tables that reference users with users.id's own collation", async () => {
    vi.resetModules();
    process.env.DB_NAME = NAME;
    try {
      const { query, getPool } = await import("@/lib/db");
      const rows = await query<Array<{ t: string; co: string }>>(
        `SELECT TABLE_NAME AS t, COLLATION_NAME AS co FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND ((TABLE_NAME = 'users' AND COLUMN_NAME = 'id') OR COLUMN_NAME = 'user_id')
           AND TABLE_NAME IN ('users', 'user_sessions', 'auth_tokens', 'user_recovery_codes')`,
        [NAME]
      );
      const users = rows.find((r) => r.t === "users")!.co;
      expect(rows.map((r) => r.t).sort()).toEqual(["auth_tokens", "user_recovery_codes", "user_sessions", "users"]);
      for (const r of rows) expect(r.co).toBe(users);
      await getPool().end();
    } finally {
      process.env.DB_NAME = base;
      vi.resetModules();
    }
  }, 30_000);
});
