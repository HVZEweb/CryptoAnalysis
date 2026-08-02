import { describe, expect, it } from "vitest";
import { query } from "@/lib/db";

describe("db schema init", () => {
  it("initializes without recursive hang", async () => {
    const rows = await query<Array<{ c: number }>>(
      "SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'",
      [process.env.DB_NAME ?? "crypto_predictor"]
    );
    expect(rows[0]?.c).toBe(1);
  }, 15_000);
});
