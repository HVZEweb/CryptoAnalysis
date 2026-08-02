import { NextResponse } from "next/server";
import {
  getAlphaRecord,
  getRegistrySummary,
  listAlphaRecords,
  runRegistryIngest,
  runRegistrySetStatus,
  type AlphaStatus,
} from "@/lib/alpha-registry";

const VALID_STATUS = new Set<AlphaStatus>(["candidate", "validated", "rejected", "retired"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) {
    const record = getAlphaRecord(id);
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ record });
  }

  return NextResponse.json({
    summary: getRegistrySummary(),
    records: listAlphaRecords(),
    workflow: {
      steps: [
        "Execution Intelligence Lab → Microstructure Lab",
        "Alpha Registry (ingest)",
        "Manual Review → validated",
        "integration_proposal.md → PR → Unified Trading Bot",
      ],
      platform_complete: true,
      bot_rule: "Только status=validated. Интеграция только через отдельный PR.",
    },
  });
}

export async function POST(request: Request) {
  let body: { action?: string; lab?: string; registry_id?: string; status?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "ingest") {
    const lab = (body.lab as "all" | "microstructure_bot" | "execution_intelligence_lab") || "all";
    const result = await runRegistryIngest(lab);
    return NextResponse.json(
      { ...result, summary: getRegistrySummary(), records: listAlphaRecords() },
      { status: result.ok ? 200 : 500 }
    );
  }

  if (body.action === "set-status") {
    const id = body.registry_id;
    const status = body.status as AlphaStatus;
    if (!id || !status || !VALID_STATUS.has(status)) {
      return NextResponse.json({ error: "registry_id and status required" }, { status: 400 });
    }
    const result = await runRegistrySetStatus(id, status, body.note || "Manual review via UI");
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
