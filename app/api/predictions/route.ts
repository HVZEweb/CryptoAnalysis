import { NextRequest, NextResponse } from "next/server";
import { getUserIdBySession } from "@/lib/auth";
import { deletePredictionsForUser, getPredictionsForUser } from "@/lib/predictions-db";
import { getSessionToken } from "@/lib/request-context";

export async function GET(request: NextRequest) {
  const userId = await getUserIdBySession(getSessionToken(request));
  if (!userId) {
    return NextResponse.json({ predictions: [] });
  }
  const limit = Math.min(200, Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10)));
  const predictions = await getPredictionsForUser(userId, limit);
  return NextResponse.json({ predictions });
}

export async function DELETE(request: NextRequest) {
  const userId = await getUserIdBySession(getSessionToken(request));
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deleted = await deletePredictionsForUser(userId);
  return NextResponse.json({ ok: true, deleted });
}
