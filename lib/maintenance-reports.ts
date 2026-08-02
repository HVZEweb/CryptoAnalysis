import fs from "fs";
import path from "path";

const RESULTS_DIR = path.join(process.cwd(), "bot", "alpha", "results");
const DATA_MANIFEST = path.join(process.cwd(), "bot", "data", "alpha", "manifest.json");
const COVERAGE_LAST = path.join(process.cwd(), "bot", "data", "alpha", "coverage_last.json");
const ARCHIVE_LAST = path.join(process.cwd(), "bot", "alpha", "results", "archive_last.json");

export type ReportKind =
  | "phase_x"
  | "discovery"
  | "coverage"
  | "alpha"
  | "archive"
  | "other";

export interface ReportMeta {
  id: string;
  filename: string;
  kind: ReportKind;
  format: "json" | "html";
  generatedAt: string | null;
  sizeBytes: number;
  hasPair: boolean;
}

function kindFromName(name: string): ReportKind {
  if (name.startsWith("phase_x_report")) return "phase_x";
  if (name.startsWith("discovery_report")) return "discovery";
  if (name.startsWith("coverage_report")) return "coverage";
  if (name.startsWith("alpha_report")) return "alpha";
  if (name === "archive_last") return "archive";
  return "other";
}

function parseGeneratedAt(name: string, data?: Record<string, unknown>): string | null {
  if (data?.generated_at && typeof data.generated_at === "string") return data.generated_at;
  if (data?.run_at && typeof data.run_at === "string") return data.run_at;
  const m = name.match(/(\d{8})_(\d{6})/);
  if (!m) return null;
  const [, d, t] = m;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
}

export function listReports(): ReportMeta[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];

  const files = fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json") || f.endsWith(".html"));
  const stems = new Set(files.map((f) => f.replace(/\.(json|html)$/, "")));

  const metas: ReportMeta[] = [];
  for (const stem of stems) {
    const jsonPath = path.join(RESULTS_DIR, `${stem}.json`);
    const htmlPath = path.join(RESULTS_DIR, `${stem}.html`);
    const primary = fs.existsSync(jsonPath) ? jsonPath : fs.existsSync(htmlPath) ? htmlPath : null;
    if (!primary) continue;

    let data: Record<string, unknown> | undefined;
    if (fs.existsSync(jsonPath)) {
      try {
        data = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
      } catch {
        data = undefined;
      }
    }

    const stat = fs.statSync(primary);
    metas.push({
      id: stem,
      filename: path.basename(primary),
      kind: kindFromName(stem),
      format: primary.endsWith(".html") ? "html" : "json",
      generatedAt: parseGeneratedAt(stem, data),
      sizeBytes: stat.size,
      hasPair: fs.existsSync(jsonPath) && fs.existsSync(htmlPath),
    });
  }

  return metas.sort((a, b) => {
    const ta = a.generatedAt ? Date.parse(a.generatedAt) : 0;
    const tb = b.generatedAt ? Date.parse(b.generatedAt) : 0;
    return tb - ta;
  });
}

export function readReportJson(id: string): Record<string, unknown> | null {
  const safe = id.replace(/[^a-zA-Z0-9_.-]/g, "");
  const jsonPath = path.join(RESULTS_DIR, `${safe}.json`);
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readReportHtml(id: string): string | null {
  const safe = id.replace(/[^a-zA-Z0-9_.-]/g, "");
  const htmlPath = path.join(RESULTS_DIR, `${safe}.html`);
  if (!fs.existsSync(htmlPath)) return null;
  try {
    return fs.readFileSync(htmlPath, "utf8");
  } catch {
    return null;
  }
}

export function readDataManifest(): Record<string, unknown> | null {
  if (!fs.existsSync(DATA_MANIFEST)) return null;
  try {
    return JSON.parse(fs.readFileSync(DATA_MANIFEST, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readCoverageLast(): Record<string, unknown> | null {
  if (!fs.existsSync(COVERAGE_LAST)) return null;
  try {
    return JSON.parse(fs.readFileSync(COVERAGE_LAST, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readArchiveLast(): Record<string, unknown> | null {
  if (!fs.existsSync(ARCHIVE_LAST)) return null;
  try {
    return JSON.parse(fs.readFileSync(ARCHIVE_LAST, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getLatestReport(kind: ReportKind): ReportMeta | undefined {
  return listReports().find((r) => r.kind === kind);
}

export function summarizePhaseX(data: Record<string, unknown>) {
  const coverage = (data.coverage as Record<string, unknown>) || {};
  const summary = (coverage.summary as Record<string, unknown>) || {};
  const quality = (data.quality as Record<string, unknown>) || {};
  const discovery = (data.discovery as Record<string, unknown>) || null;
  const sections = (data.sections as Record<string, unknown>) || {};

  return {
    generatedAt: data.generated_at as string,
    elapsedSec: data.elapsed_sec as number,
    finalVerdict: data.final_verdict as string,
    discoveryReady: summary.discovery_ready as boolean,
    sourcesPresent: summary.present as number,
    sourcesTotal: summary.total_sources as number,
    qualityPassed: quality.passed as number,
    qualityTotal: quality.total as number,
    accepted: discovery ? ((discovery.accepted as string[]) || []).length : null,
    significantFeatures: (sections.statistically_significant_features as string[]) || [],
    retryAfter: (sections.retry_after_accumulation as string[]) || [],
  };
}
