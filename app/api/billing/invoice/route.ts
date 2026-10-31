import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getUserIdBySession } from "@/lib/auth";
import { getSessionToken } from "@/lib/request-context";
import { billingConfig, usdt } from "@/services/payments/logic";
import { openInvoice } from "@/services/payments/store";

export const dynamic = "force-dynamic";

/** An invoice to pay: wallet, exact amount, deadline, and a QR code of the wallet address. */
export async function POST(request: NextRequest) {
  const userId = await getUserIdBySession(getSessionToken(request));
  if (!userId) return NextResponse.json({ error: "Войдите, чтобы оформить подписку" }, { status: 401 });
  if (!billingConfig()) return NextResponse.json({ error: "Оплата пока не подключена" }, { status: 503 });
  const inv = await openInvoice(userId);
  const qr = await QRCode.toString(inv.address, { type: "svg", margin: 1, color: { dark: "#0d0d14", light: "#ffffff" } });
  return NextResponse.json({ id: inv.id, address: inv.address, amount: usdt(inv.amountMicro), days: inv.days, status: inv.status, expiresAt: inv.expiresAt, qr });
}
