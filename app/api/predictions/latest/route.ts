import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSessionToken } from "@/lib/request-context";
import { getUserIdBySession } from "@/lib/auth";

interface PredictionRow {
  id: string;
  symbol: string;
  coin_name: string;
  market: string;
  timeframe: string;
  direction: string;
  probability: number;
  price_at_prediction: string;
  entry_price: string | null;
  tp_price: string | null;
  sl_price: string | null;
  exit_price: string | null;
  payload: string;
  created_at: Date;
}

export async function GET(request: NextRequest) {
  try {
    const sessionToken = getSessionToken(request);
    const userId = await getUserIdBySession(sessionToken);

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const rows = await query<PredictionRow[]>(
      `SELECT id, symbol, coin_name, market, timeframe, direction, probability,
              price_at_prediction, entry_price, tp_price, sl_price, exit_price,
              payload, created_at
       FROM predictions
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No predictions found" },
        { status: 404 }
      );
    }

    const row = rows[0];
    const payload = JSON.parse(row.payload);

    const prediction = {
      id: row.id,
      symbol: row.symbol,
      coin: row.coin_name,
      market: row.market,
      timeframe: row.timeframe,
      direction: row.direction,
      probability: row.probability,
      priceAtPrediction: parseFloat(row.price_at_prediction),
      tradeLevels: {
        entry: row.entry_price ? parseFloat(row.entry_price) : null,
        tp: row.tp_price ? parseFloat(row.tp_price) : null,
        sl: row.sl_price ? parseFloat(row.sl_price) : null,
        exit: row.exit_price ? parseFloat(row.exit_price) : null,
      },
      priceForecast: payload.priceForecast,
      createdAt: row.created_at.toISOString(),
      ...payload,
    };

    return NextResponse.json({ prediction });
  } catch (error) {
    console.error("[predictions/latest] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
