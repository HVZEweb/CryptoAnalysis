import { beforeAll, describe, expect, it, vi } from "vitest";
import { USDT_TRC20_CONTRACT, type Transfer } from "@/services/payments/logic";

const WALLET = "TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL";
const transfers: Transfer[] = [];
vi.mock("@/services/payments/tron", () => ({ incomingTransfers: async () => transfers }));

describe("payment flow against the database", () => {
  beforeAll(() => {
    process.env.PAYMENT_USDT_TRC20_ADDRESS = WALLET;
  });

  it("turns a transfer of the invoice amount into 30 paid days, once", async () => {
    const { registerUser, findUserById, hasPaidAccess } = await import("@/lib/auth");
    const { openInvoice, checkPayments, invoiceOf } = await import("@/services/payments/store");
    const { user } = await registerUser(`buyer-${Date.now()}@test.local`, "password-123", crypto.randomUUID());
    const now = Date.now();

    const inv = await openInvoice(user.id, now);
    expect((await openInvoice(user.id, now)).id).toBe(inv.id); // reused while open
    // (the first user of an empty database is an admin, so the subscription itself is checked)
    expect((await findUserById(user.id))!.paidUntil).toBeNull();

    transfers.push({ txId: `tx-${inv.id}`, value: inv.amountMicro, timestamp: now + 60_000, to: WALLET, contract: USDT_TRC20_CONTRACT });
    expect(await checkPayments(now + 120_000)).toBe(1);
    expect((await invoiceOf(user.id, inv.id))!.status).toBe("paid");
    const paid = (await findUserById(user.id))!;
    expect(hasPaidAccess({ ...paid, role: "user", tier: "registered" })).toBe(true);
    expect(paid.paidUntil! - (now + 120_000)).toBeCloseTo(30 * 86_400_000, -5);

    // The same transaction is never counted twice.
    expect(await checkPayments(now + 600_000)).toBe(0);
    expect((await findUserById(user.id))!.paidUntil).toBe(paid.paidUntil);
  }, 30_000);
});
