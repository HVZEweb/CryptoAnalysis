import { NextRequest, NextResponse } from "next/server";
import { getUserIdBySession } from "@/lib/auth";
import { getSessionToken } from "@/lib/request-context";
import { opportunityDetail } from "@/services/opportunities/card";

export const dynamic = "force-dynamic";

/** One opportunity's card: plan, live state or result, why it was sent, the coin and a price chart. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getUserIdBySession(getSessionToken(request)))) {
    return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Нет такой карточки" }, { status: 404 });
  const card = await opportunityDetail(id);
  if (!card) return NextResponse.json({ error: "Нет такой карточки" }, { status: 404 });
  return NextResponse.json(card);
}
