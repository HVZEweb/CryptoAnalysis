/** Forward-test book in MySQL: one row per variant and day, and the weights set at each rebalance. */

import { execute, query } from "@/lib/db";

let ready = false;

export async function ensureCarryTables(): Promise<void> {
  if (ready) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS carry_day (
      variant VARCHAR(20) NOT NULL,
      day BIGINT NOT NULL,
      price_ret DOUBLE NOT NULL,
      funding_ret DOUBLE NOT NULL,
      cost DOUBLE NOT NULL,
      PRIMARY KEY (variant, day)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS carry_weights (
      variant VARCHAR(20) NOT NULL,
      day BIGINT NOT NULL,
      weights JSON NOT NULL,
      cost DOUBLE NOT NULL,
      PRIMARY KEY (variant, day)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  ready = true;
}

export interface CarryDayRow {
  variant: string;
  day: number;
  price_ret: number;
  funding_ret: number;
  cost: number;
}

export async function lastDay(variant: string): Promise<number | null> {
  await ensureCarryTables();
  const rows = await query<Array<{ day: number | null }>>("SELECT MAX(day) AS day FROM carry_day WHERE variant = ?", [variant]);
  return rows[0]?.day == null ? null : Number(rows[0].day);
}

export async function saveDay(r: CarryDayRow): Promise<void> {
  await execute(
    `INSERT INTO carry_day (variant, day, price_ret, funding_ret, cost) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE price_ret = VALUES(price_ret), funding_ret = VALUES(funding_ret), cost = VALUES(cost)`,
    [r.variant, r.day, r.price_ret, r.funding_ret, r.cost]
  );
}

export async function days(variant: string): Promise<CarryDayRow[]> {
  await ensureCarryTables();
  const rows = await query<CarryDayRow[]>("SELECT * FROM carry_day WHERE variant = ? ORDER BY day", [variant]);
  return rows.map((r) => ({ ...r, day: Number(r.day), price_ret: Number(r.price_ret), funding_ret: Number(r.funding_ret), cost: Number(r.cost) }));
}

/** Weights in force after `day`'s close: the latest rebalance on or before it. */
export async function weightsAt(variant: string, day: number): Promise<{ day: number; weights: Record<string, number>; cost: number } | null> {
  await ensureCarryTables();
  const rows = await query<Array<{ day: number; weights: string | Record<string, number>; cost: number }>>(
    "SELECT day, weights, cost FROM carry_weights WHERE variant = ? AND day <= ? ORDER BY day DESC LIMIT 1",
    [variant, day]
  );
  const r = rows[0];
  if (!r) return null;
  return { day: Number(r.day), weights: typeof r.weights === "string" ? JSON.parse(r.weights) : r.weights, cost: Number(r.cost) };
}

export async function saveWeights(variant: string, day: number, weights: Record<string, number>, cost: number): Promise<void> {
  await execute(
    `INSERT INTO carry_weights (variant, day, weights, cost) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE weights = VALUES(weights), cost = VALUES(cost)`,
    [variant, day, JSON.stringify(weights), cost]
  );
}
