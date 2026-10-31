import { NextRequest, NextResponse } from "next/server";
import { findUserById, getUserIdBySession, hasPaidAccess } from "@/lib/auth";
import { getSessionToken } from "@/lib/request-context";
import { billingConfig } from "@/services/payments/logic";
import { paymentsOf } from "@/services/payments/store";

export const dynamic = "force-dynamic";

/** Subscription offer and the signed-in user's state. */
export async function GET(request: NextRequest) {
  const cfg = billingConfig();
  const userId = await getUserIdBySession(getSessionToken(request));
  const user = userId ? await findUserById(userId) : null;
  return NextResponse.json({
    configured: !!cfg,
    priceUsdt: cfg?.priceUsdt ?? null,
    periodDays: cfg?.periodDays ?? null,
    isLoggedIn: !!user,
    paid: user ? hasPaidAccess(user) : false,
    paidUntil: user?.paidUntil ?? null,
    permanent: !!user && (user.role === "admin" || user.tier === "paid"),
    payments: user && cfg ? (await paymentsOf(user.id)).map((p) => ({ id: p.id, amount: p.amountMicro / 1e6, paidAt: p.paidAt, txId: p.txId, days: p.days })) : [],
  });
}
