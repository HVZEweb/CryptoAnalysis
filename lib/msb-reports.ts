import fs from "fs";
import path from "path";

const MSB_DIR = path.join(process.cwd(), "microstructure_bot");
const RESULTS_DIR = path.join(MSB_DIR, "results");

export type MsbReportKind = "daily" | "weekly" | "study" | "alpha" | "conclusion" | "other";

export interface MsbReportMeta {
  id: string;
  filename: string;
  kind: MsbReportKind;
  format: "json" | "md" | "html";
  generatedAt: string | null;
  sizeBytes: number;
}

const HYPOTHESES = [
  "imbalance",
  "sweep",
  "liquidity_vanish",
  "absorption",
  "replenishment",
  "cumulative_delta",
  "spread_expand",
  "book_flow_combo",
];

function kindFromName(name: string): MsbReportKind {
  if (name === "daily_report" || name.startsWith("daily_report")) return "daily";
  if (name.startsWith("weekly_report")) return "weekly";
  if (name.startsWith("study_")) return "study";
  if (name === "alpha_candidate" || name === "report_alpha_candidate") return "alpha";
  if (name === "research_conclusion") return "conclusion";
  return "other";
}

function parseGeneratedAt(name: string, data?: Record<string, unknown>): string | null {
  if (data?.generated_at && typeof data.generated_at === "string") return data.generated_at;
  const m = name.match(/(\d{8})_(\d{6})/);
  if (!m) return null;
  const [, d, t] = m;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
}

export function listMsbReports(): MsbReportMeta[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];

  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json") || f.endsWith(".md") || f.endsWith(".html"));

  const metas: MsbReportMeta[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    const stem = f.replace(/\.(json|md|html)$/, "");
    if (seen.has(stem)) continue;
    seen.add(stem);

    const full = path.join(RESULTS_DIR, f);
    let data: Record<string, unknown> | undefined;
    const jsonPath = path.join(RESULTS_DIR, `${stem}.json`);
    if (fs.existsSync(jsonPath)) {
      try {
        data = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
      } catch {
        data = undefined;
      }
    }

    const stat = fs.statSync(full);
    metas.push({
      id: stem,
      filename: f,
      kind: kindFromName(stem),
      format: f.endsWith(".html") ? "html" : f.endsWith(".md") ? "md" : "json",
      generatedAt: parseGeneratedAt(stem, data),
      sizeBytes: stat.size,
    });
  }

  return metas.sort((a, b) => {
    const ta = a.generatedAt ? Date.parse(a.generatedAt) : 0;
    const tb = b.generatedAt ? Date.parse(b.generatedAt) : 0;
    return tb - ta;
  });
}

export function readMsbReportJson(id: string): Record<string, unknown> | null {
  const safe = id.replace(/[^a-zA-Z0-9_.-]/g, "");
  const jsonPath = path.join(RESULTS_DIR, `${safe}.json`);
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readMsbReportMarkdown(id: string): string | null {
  const safe = id.replace(/[^a-zA-Z0-9_.-]/g, "");
  const mdPath = path.join(RESULTS_DIR, `${safe}.md`);
  if (!fs.existsSync(mdPath)) return null;
  try {
    return fs.readFileSync(mdPath, "utf8");
  } catch {
    return null;
  }
}

export function readDailyReport(): Record<string, unknown> | null {
  return readMsbReportJson("daily_report");
}

export function readWeeklyLatest(): Record<string, unknown> | null {
  return readMsbReportJson("weekly_report_latest");
}

export function summarizeDaily(data: Record<string, unknown>) {
  const inv = (data.inventory as Record<string, unknown>) || {};
  const totals = (inv.totals as Record<string, number>) || {};
  const checks = (inv.checks as Record<string, boolean>) || {};
  return {
    healthy: Boolean(data.healthy),
    issues: (data.issues as string[]) || [],
    historySpanDays: Number(inv.history_span_days) || 0,
    totalRows: Number(totals.rows) || 0,
    checks,
    recommendations: (data.recommendations as string[]) || [],
    generatedAt: (data.generated_at as string) || null,
  };
}

export function summarizeWeekly(data: Record<string, unknown>) {
  const hypotheses = (data.hypotheses as Array<Record<string, unknown>>) || [];
  return {
    generatedAt: (data.generated_at as string) || null,
    hypothesesTested: Number(data.hypotheses_tested) || 0,
    acceptedCount: Number(data.accepted_count) || 0,
    alphaCandidates: (data.alpha_candidates as string[]) || [],
    dataSpanDays: Number(data.data_span_days) || 0,
    comparisons: hypotheses.map((h) => ({
      id: h.hypothesis_id as string,
      accepted: Boolean(h.accepted),
      comparison: h.comparison as Record<string, unknown>,
    })),
    hasFinalConclusion: Boolean(data.final_conclusion_path),
  };
}

export function getDataMilestones() {
  const daily = readDailyReport();
  const weekly = readWeeklyLatest();
  const inv = (daily?.inventory as Record<string, unknown>) || {};
  const spanDays = Number(inv.history_span_days) || 0;
  const ob = (inv.per_kind as Record<string, Record<string, { rows: number }>>)?.orderbook;
  const obRows = ob
    ? Object.values(ob).reduce((s, v) => s + (Number(v?.rows) || 0), 0)
    : 0;

  const weeklyCount = listMsbReports().filter((r) => r.kind === "weekly" && r.id !== "weekly_report_latest").length;
  const hasAlpha = fs.existsSync(path.join(RESULTS_DIR, "alpha_candidate.md"));
  const hasConclusion = fs.existsSync(path.join(RESULTS_DIR, "research_conclusion.md"));

  return {
    historySpanDays: { current: spanDays, target: 28, met: spanDays >= 28 },
    orderbookRows: { current: obRows, target: 50_000, met: obRows >= 50_000 },
    weeklyCycles: { current: weeklyCount, target: 4, met: weeklyCount >= 4 },
    lastDaily: (daily?.generated_at as string) || null,
    lastWeekly: (weekly?.generated_at as string) || null,
    hasAlphaCandidate: hasAlpha,
    hasResearchConclusion: hasConclusion,
  };
}

export function getHypothesisList() {
  return HYPOTHESES;
}
