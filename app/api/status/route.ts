import { NextResponse } from "next/server";
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/openrouter-models";
import { query } from "@/lib/db";
import { checkOpenRouterKey, checkOpenRouterReachability } from "@/lib/openrouter-health";

export async function GET() {
  const checks: Record<string, { ok: boolean; message: string }> = {
    app: { ok: true, message: "Next.js API работает" },
  };

  try {
    await query("SELECT 1 AS ok");
    checks.mysql = { ok: true, message: "MySQL подключён" };
  } catch (error) {
    checks.mysql = {
      ok: false,
      message: error instanceof Error ? error.message : "MySQL недоступен — запустите XAMPP",
    };
  }

  const openrouter = await checkOpenRouterKey(process.env.OPENROUTER_API_KEY);
  const network = await checkOpenRouterReachability();
  checks.network = { ok: network.ok, message: network.message };
  checks.openrouter = { ok: openrouter.ok, message: openrouter.message };

  const relevant = ["app", "mysql", "openrouter"];
  const allOk = relevant.every((key) => checks[key]?.ok);

  return NextResponse.json({
    ok: allOk,
    provider: "openrouter",
    siteUrl: "http://localhost:3000",
    predictEndpoint: "POST http://localhost:3000/api/predict/stream",
    env: {
      model: process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL,
      hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    },
    checks,
  });
}
