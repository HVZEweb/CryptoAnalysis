/**
 * Verify MySQL connection and auto-create schema.
 * Run: npm run db:init
 */
import { query } from "../lib/db";

async function main() {
  const rows = await query<Array<{ ok: number }>>("SELECT 1 AS ok");
  console.log("MySQL OK:", rows[0]?.ok === 1 ? "connected" : "unknown");
  const tables = await query<Array<{ TABLE_NAME: string }>>(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
    [process.env.DB_NAME ?? "crypto_predictor"]
  );
  console.log("Tables:", tables.map((t) => t.TABLE_NAME).join(", ") || "(none)");
}

main().catch((err) => {
  console.error("DB init failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
