import { describe, expect, it } from "vitest";
import { hasPaidAccess } from "@/lib/auth";
import {
  INVOICE_TTL_MS,
  LATE_GRACE_MS,
  USDT_TRC20_CONTRACT,
  billingConfig,
  extendPaidUntil,
  isTronAddress,
  matchTransfers,
  uniqueAmountMicro,
  usdt,
} from "@/services/payments/logic";

const WALLET = "TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL";
const DAY = 86_400_000;

describe("billing config", () => {
  it("needs a valid TRON address and takes price and period from the environment", () => {
    expect(billingConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(billingConfig({ PAYMENT_USDT_TRC20_ADDRESS: "0xabc" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(billingConfig({ PAYMENT_USDT_TRC20_ADDRESS: WALLET } as unknown as NodeJS.ProcessEnv)).toEqual({ address: WALLET, priceUsdt: 9, periodDays: 30 });
    expect(isTronAddress(WALLET)).toBe(true);
  });
});

describe("invoice amounts", () => {
  it("adds 1–99 cents that no open invoice uses, in whole cents", () => {
    const a = uniqueAmountMicro(9, [], () => 0);
    expect(usdt(a)).toBe("9.01");
    const taken = Array.from({ length: 98 }, (_, i) => (901 + i) * 10_000);
    expect(usdt(uniqueAmountMicro(9, taken, () => 0))).toBe("9.99");
    // all 99 cents of 9.xx taken → the next dollar
    expect(usdt(uniqueAmountMicro(9, [...taken, 999 * 10_000], () => 0))).toBe("10.01");
  });
});

describe("matching transfers to invoices", () => {
  const t0 = Date.UTC(2026, 9, 31, 12);
  const inv = { id: "a", amountMicro: 9_370_000, createdAt: t0, expiresAt: t0 + INVOICE_TTL_MS };
  const tr = (over: Partial<{ txId: string; value: number; timestamp: number; to: string; contract: string }>) => ({
    txId: "tx1",
    value: 9_370_000,
    timestamp: t0 + 5 * 60_000,
    to: WALLET,
    contract: USDT_TRC20_CONTRACT,
    ...over,
  });

  it("pays the invoice with the exact amount to the wallet", () => {
    expect(matchTransfers([inv], [tr({})], WALLET, new Set())).toEqual([{ invoiceId: "a", txId: "tx1", paidAt: t0 + 5 * 60_000 }]);
  });

  it("ignores other amounts, other tokens, other wallets and reused transactions", () => {
    expect(matchTransfers([inv], [tr({ value: 9_000_000 })], WALLET, new Set())).toEqual([]);
    expect(matchTransfers([inv], [tr({ contract: "Tfake" })], WALLET, new Set())).toEqual([]);
    expect(matchTransfers([inv], [tr({ to: "Tother" })], WALLET, new Set())).toEqual([]);
    expect(matchTransfers([inv], [tr({})], WALLET, new Set(["tx1"]))).toEqual([]);
  });

  it("accepts a late transfer for a day after the invoice expired, not before it was created", () => {
    expect(matchTransfers([inv], [tr({ timestamp: inv.expiresAt + LATE_GRACE_MS - 1000 })], WALLET, new Set())).toHaveLength(1);
    expect(matchTransfers([inv], [tr({ timestamp: inv.expiresAt + LATE_GRACE_MS + 1000 })], WALLET, new Set())).toEqual([]);
    expect(matchTransfers([inv], [tr({ timestamp: t0 - 10 * 60_000 })], WALLET, new Set())).toEqual([]);
  });

  it("pays one invoice once even if the same amount arrives twice", () => {
    expect(matchTransfers([inv], [tr({}), tr({ txId: "tx2", timestamp: t0 + 6 * 60_000 })], WALLET, new Set())).toHaveLength(1);
  });
});

describe("subscription", () => {
  const now = Date.UTC(2026, 9, 31);

  it("extends an active subscription from its end and a lapsed one from now", () => {
    expect(extendPaidUntil(now + 5 * DAY, now, 30)).toBe(now + 35 * DAY);
    expect(extendPaidUntil(now - 5 * DAY, now, 30)).toBe(now + 30 * DAY);
    expect(extendPaidUntil(null, now, 30)).toBe(now + 30 * DAY);
  });

  it("gives paid access to admins, permanent grants and unexpired subscriptions", () => {
    expect(hasPaidAccess({ role: "user", tier: "registered", paidUntil: now + DAY }, now)).toBe(true);
    expect(hasPaidAccess({ role: "user", tier: "registered", paidUntil: now - DAY }, now)).toBe(false);
    expect(hasPaidAccess({ role: "user", tier: "paid", paidUntil: null }, now)).toBe(true);
    expect(hasPaidAccess({ role: "admin", tier: "registered", paidUntil: null }, now)).toBe(true);
  });
});
