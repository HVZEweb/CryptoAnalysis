import { denyUnlessAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { runMlRetrain } from "@/services/ml-retrain";

export async function POST(request: Request) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;

  const result = await runMlRetrain();
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: "ML_RETRAIN_FAILED", message: result.error ?? "Retrain failed" }, result },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, result });
}
