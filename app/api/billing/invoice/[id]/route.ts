import { NextRequest, NextResponse } from "next/server";
import { findUserById, getUserIdBySession } from "@/lib/auth";
import { getSessionToken } from "@/lib/request-context";
import { checkPayments, invoiceOf } from "@/services/payments/store";

export const dynamic = "force-dynamic";

/** Polled by the payment window: checks the blockchain (throttled) and returns the invoice status. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserIdBySession(getSessionToken(request));
  if (!userId) return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
  const { id } = await params;
  let inv = await invoiceOf(userId, id);
  if (!inv) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 });
  if (inv.status !== "paid") {
    await checkPayments().catch((e) => console.warn("[payments] check failed:", (e as Error).message));
    inv = (await invoiceOf(userId, id))!;
  }
  const user = await findUserById(userId);
  return NextResponse.json({ status: inv.status, expiresAt: inv.expiresAt, txId: inv.txId, paidUntil: user?.paidUntil ?? null });
}
