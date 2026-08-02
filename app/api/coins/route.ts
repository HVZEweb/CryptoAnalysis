import { NextResponse } from "next/server";
import { getCoins } from "@/lib/coins";

export const revalidate = 21600;

export async function GET() {
  try {
    const coins = await getCoins();
    return NextResponse.json(
      { coins },
      { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=3600" } }
    );
  } catch (error) {
    const err = error as { code?: string; message?: string };
    return NextResponse.json(
      { error: { code: err.code ?? "API_UNAVAILABLE", message: err.message ?? "Не удалось загрузить список монет" } },
      { status: 500 }
    );
  }
}
