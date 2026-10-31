import { NextRequest, NextResponse } from "next/server";
import { accessOf } from "@/lib/access";
import { opportunityDetail } from "@/services/opportunities/card";

export const dynamic = "force-dynamic";

/** One opportunity's card. Closed ones are open to every signed-in user; a live one needs a subscription. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, paid } = await accessOf(request);
  if (!user) return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Нет такой карточки" }, { status: 404 });
  const card = await opportunityDetail(id);
  if (!card) return NextResponse.json({ error: "Нет такой карточки" }, { status: 404 });
  if (card.status === "open" && !paid) {
    return NextResponse.json({ error: "Сделка ещё идёт: план и уровни открыты по подписке.", locked: true }, { status: 402 });
  }
  return NextResponse.json(card);
}
