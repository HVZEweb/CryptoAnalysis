/** Invoices and subscription payments in MySQL, and the check that turns a transfer into paid time. */

import { randomBytes } from "crypto";
import { execute, query, withTransaction } from "@/lib/db";
import {
  INVOICE_TTL_MS,
  LATE_GRACE_MS,
  billingConfig,
  extendPaidUntil,
  matchTransfers,
  uniqueAmountMicro,
  type OpenInvoice,
} from "@/services/payments/logic";
import { incomingTransfers } from "@/services/payments/tron";

let ready = false;

async function ensureTables(): Promise<void> {
  if (ready) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS payment_invoice (
      id CHAR(24) NOT NULL PRIMARY KEY,
      user_id CHAR(24) NOT NULL,
      address VARCHAR(64) NOT NULL,
      amount_micro BIGINT NOT NULL,
      days INT NOT NULL,
      status ENUM('pending','paid','expired') NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      tx_id VARCHAR(80) NULL UNIQUE,
      paid_at BIGINT NULL,
      INDEX idx_invoice_user (user_id, created_at),
      INDEX idx_invoice_status (status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  ready = true;
}

export interface Invoice {
  id: string;
  address: string;
  amountMicro: number;
  days: number;
  status: "pending" | "paid" | "expired";
  createdAt: number;
  expiresAt: number;
  txId: string | null;
  paidAt: number | null;
}

interface Row {
  id: string;
  user_id: string;
  address: string;
  amount_micro: number | string;
  days: number;
  status: Invoice["status"];
  created_at: number | string;
  expires_at: number | string;
  tx_id: string | null;
  paid_at: number | string | null;
}

const map = (r: Row): Invoice => ({
  id: r.id,
  address: r.address,
  amountMicro: Number(r.amount_micro),
  days: r.days,
  status: r.status,
  createdAt: Number(r.created_at),
  expiresAt: Number(r.expires_at),
  txId: r.tx_id,
  paidAt: r.paid_at == null ? null : Number(r.paid_at),
});

/** The user's open invoice if there is one, else a new one with a unique amount. */
export async function openInvoice(userId: string, now = Date.now()): Promise<Invoice> {
  const cfg = billingConfig();
  if (!cfg) throw new Error("оплата не настроена");
  await ensureTables();
  const [existing] = await query<Row[]>(
    "SELECT * FROM payment_invoice WHERE user_id = ? AND status = 'pending' AND expires_at > ? AND address = ? ORDER BY created_at DESC LIMIT 1",
    [userId, now + 5 * 60_000, cfg.address]
  );
  if (existing) return map(existing);
  // Amounts of invoices that may still be paid (late payments included) are not reused.
  const taken = await query<Array<{ amount_micro: number | string }>>(
    "SELECT amount_micro FROM payment_invoice WHERE status <> 'paid' AND expires_at > ?",
    [now - LATE_GRACE_MS]
  );
  const inv: Invoice = {
    id: randomBytes(12).toString("hex"),
    address: cfg.address,
    amountMicro: uniqueAmountMicro(cfg.priceUsdt, taken.map((t) => Number(t.amount_micro))),
    days: cfg.periodDays,
    status: "pending",
    createdAt: now,
    expiresAt: now + INVOICE_TTL_MS,
    txId: null,
    paidAt: null,
  };
  await execute(
    "INSERT INTO payment_invoice (id, user_id, address, amount_micro, days, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
    [inv.id, userId, inv.address, inv.amountMicro, inv.days, inv.createdAt, inv.expiresAt]
  );
  return inv;
}

export async function invoiceOf(userId: string, id: string): Promise<Invoice | null> {
  await ensureTables();
  const [row] = await query<Row[]>("SELECT * FROM payment_invoice WHERE id = ? AND user_id = ?", [id, userId]);
  return row ? map(row) : null;
}

export async function paymentsOf(userId: string): Promise<Invoice[]> {
  await ensureTables();
  return (await query<Row[]>("SELECT * FROM payment_invoice WHERE user_id = ? AND status = 'paid' ORDER BY paid_at DESC LIMIT 50", [userId])).map(map);
}

let lastCheck = 0;
let checking: Promise<number> | null = null;

/**
 * Looks for transfers that pay open invoices and extends those users' subscriptions. Throttled: at most
 * one TronGrid request per 15 s however many pages poll. Returns how many invoices it paid.
 */
export function checkPayments(now = Date.now()): Promise<number> {
  if (checking) return checking;
  if (now - lastCheck < 15_000) return Promise.resolve(0);
  lastCheck = now;
  checking = runCheck(now).finally(() => (checking = null));
  return checking;
}

async function runCheck(now: number): Promise<number> {
  const cfg = billingConfig();
  if (!cfg) return 0;
  await ensureTables();
  await execute("UPDATE payment_invoice SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?", [now]);
  const open = (
    await query<Row[]>("SELECT * FROM payment_invoice WHERE status <> 'paid' AND address = ? AND expires_at > ?", [cfg.address, now - LATE_GRACE_MS])
  ).map(map);
  if (!open.length) return 0;

  const transfers = await incomingTransfers(cfg.address, Math.min(...open.map((i) => i.createdAt)) - 60_000);
  const used = new Set(
    (await query<Array<{ tx_id: string }>>("SELECT tx_id FROM payment_invoice WHERE tx_id IS NOT NULL AND paid_at > ?", [now - 3 * LATE_GRACE_MS])).map((r) => r.tx_id)
  );
  const matches = matchTransfers(open as OpenInvoice[], transfers, cfg.address, used);
  let paid = 0;
  for (const m of matches) {
    const ok = await withTransaction(async (conn) => {
      const [res] = await conn.execute("UPDATE payment_invoice SET status = 'paid', tx_id = ?, paid_at = ? WHERE id = ? AND status <> 'paid'", [m.txId, m.paidAt, m.invoiceId]);
      if ((res as { affectedRows: number }).affectedRows !== 1) return false;
      const inv = open.find((i) => i.id === m.invoiceId)!;
      const [rows] = await conn.execute(
        "SELECT u.id, u.paid_until FROM users u JOIN payment_invoice p ON p.user_id = u.id WHERE p.id = ? FOR UPDATE",
        [m.invoiceId]
      );
      const user = (rows as Array<{ id: string; paid_until: number | string | null }>)[0];
      if (!user) return false;
      const until = extendPaidUntil(user.paid_until == null ? null : Number(user.paid_until), now, inv.days);
      await conn.execute("UPDATE users SET paid_until = ? WHERE id = ?", [until, user.id]);
      return true;
    });
    if (ok) paid++;
  }
  if (paid) console.log(`[payments] ${paid} invoice(s) paid`);
  return paid;
}
