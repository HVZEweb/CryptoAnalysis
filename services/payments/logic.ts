/**
 * Subscription paid in USDT (TRC20) straight to the owner's wallet — no payment provider.
 *
 * Every invoice gets a unique amount (the price plus a few cents), so a transfer of exactly that amount
 * to the wallet identifies the invoice. Only confirmed transfers of the USDT contract count, a transaction
 * pays at most one invoice, and a transfer is accepted from the invoice's creation until a day after it
 * expired (people pay late). Everything here is pure; I/O lives in services/payments/store.ts and tron.ts.
 */

export const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
/** USDT has 6 decimals; amounts are kept as integers in these units. */
export const MICRO = 1_000_000;
export const INVOICE_TTL_MS = 60 * 60_000;
/** A transfer that arrives this long after the invoice expired still pays it. */
export const LATE_GRACE_MS = 24 * 60 * 60_000;

export interface BillingConfig {
  address: string;
  priceUsdt: number;
  periodDays: number;
}

/** TRON addresses: base58, 34 characters, starting with T. */
export const isTronAddress = (a: string) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);

export function billingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig | null {
  const address = env.PAYMENT_USDT_TRC20_ADDRESS?.trim() ?? "";
  if (!isTronAddress(address)) return null;
  const priceUsdt = Number(env.PAYMENT_PRICE_USDT ?? 9);
  const periodDays = Number(env.PAYMENT_PERIOD_DAYS ?? 30);
  if (!(priceUsdt > 0) || !(periodDays > 0)) return null;
  return { address, priceUsdt, periodDays };
}

/**
 * A unique amount for a new invoice: the price plus 1–99 cents that no open invoice uses (then the next
 * dollar). Whole cents, because many wallets and exchanges don't let people type more decimals.
 */
export function uniqueAmountMicro(priceUsdt: number, taken: Iterable<number>, random = Math.random): number {
  const used = new Set(taken);
  const base = Math.round(priceUsdt * 100);
  for (let extraDollars = 0; extraDollars < 20; extraDollars++) {
    const start = 1 + Math.floor(random() * 99);
    for (let i = 0; i < 99; i++) {
      const cents = base + extraDollars * 100 + ((start - 1 + i) % 99) + 1;
      const micro = cents * 10_000;
      if (!used.has(micro)) return micro;
    }
  }
  throw new Error("нет свободной суммы для счёта");
}

export interface OpenInvoice {
  id: string;
  amountMicro: number;
  createdAt: number;
  expiresAt: number;
}

export interface Transfer {
  txId: string;
  /** Amount in micro-USDT */
  value: number;
  timestamp: number;
  to: string;
  contract: string;
}

/**
 * Which invoice each transfer pays: same wallet and contract, the exact amount, arriving within the
 * invoice's window. Transfers already used for an invoice are skipped, and each invoice is paid once.
 */
export function matchTransfers(invoices: OpenInvoice[], transfers: Transfer[], address: string, usedTx: Set<string>): Array<{ invoiceId: string; txId: string; paidAt: number }> {
  const out: Array<{ invoiceId: string; txId: string; paidAt: number }> = [];
  const paid = new Set<string>();
  for (const t of [...transfers].sort((a, b) => a.timestamp - b.timestamp)) {
    if (usedTx.has(t.txId) || t.to !== address || t.contract !== USDT_TRC20_CONTRACT) continue;
    const inv = invoices.find(
      (i) => !paid.has(i.id) && i.amountMicro === t.value && t.timestamp >= i.createdAt - 60_000 && t.timestamp <= i.expiresAt + LATE_GRACE_MS
    );
    if (!inv) continue;
    paid.add(inv.id);
    usedTx.add(t.txId);
    out.push({ invoiceId: inv.id, txId: t.txId, paidAt: t.timestamp });
  }
  return out;
}

/** A payment extends an active subscription from its end, a lapsed one from now. */
export function extendPaidUntil(current: number | null, now: number, days: number): number {
  return Math.max(current ?? 0, now) + days * 86_400_000;
}

export const usdt = (micro: number) => (micro / MICRO).toFixed(2);
