import { NextResponse } from "next/server";
import fs from "fs/promises";
import { backtester } from "@/lib/backtesting/backtester";
import { TRAINING_JSONL_PATH } from "@/lib/backtesting/training-export";

/** Export in-memory training rows or return existing JSONL */
export async function POST() {
  try {
    const result = await backtester.exportTrainingData();
    return NextResponse.json({ ok: true, export: result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

/** Download `.cache/backtest-training.jsonl` */
export async function GET() {
  try {
    const raw = await fs.readFile(TRAINING_JSONL_PATH, "utf-8");
    return new NextResponse(raw, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": 'attachment; filename="backtest-training.jsonl"',
      },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Training file not found — run backtest with exportTraining first" } },
      { status: 404 }
    );
  }
}
