import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const REGISTRY_PATH = path.join(process.cwd(), "alpha_registry", "data", "registry.json");

export type AlphaStatus = "candidate" | "validated" | "rejected" | "retired";

export interface HistoryEntry {
  at: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  note: string;
  actor: string;
  study_ref: string | null;
}

export interface AlphaRecord {
  registry_id: string;
  source_lab: string;
  hypothesis_id: string;
  title: string;
  description: string;
  economic_rationale: string;
  data: {
    symbols: string[];
    span_days: number;
    orderbook_rows: number;
    trade_rows: number;
    events_total: number;
    study_generated_at: string | null;
    study_file: string | null;
    fee_cost_pct: number | null;
  };
  validation: {
    oos_pass: boolean;
    walk_forward_stable: boolean;
    bootstrap_p_min: number | null;
    cross_symbol_pass: boolean;
    cross_session_pass: boolean | null;
    cross_day_pass: boolean | null;
    per_symbol: Record<string, unknown>[];
    study_accepted: boolean;
  };
  metrics: {
    expectancy_pct: number | null;
    profit_factor: number | null;
    horizon_sec: number | null;
    information_coefficient: number | null;
    mae_pct: number | null;
    mfe_pct: number | null;
  };
  limitations: string[];
  overfitting_risk: string;
  status: AlphaStatus;
  history: HistoryEntry[];
  registered_at: string;
  updated_at: string;
  bot_integration_eligible: boolean;
}

interface RegistryFile {
  version: number;
  updated_at: string;
  meta?: Record<string, unknown>;
  entries: Record<string, AlphaRecord>;
}

const STATUS_LABELS: Record<AlphaStatus, string> = {
  candidate: "Candidate",
  validated: "Validated",
  rejected: "Rejected",
  retired: "Retired",
};

const STATUS_COLORS: Record<AlphaStatus, string> = {
  candidate: "text-amber-300",
  validated: "text-emerald-300",
  rejected: "text-muted-foreground",
  retired: "text-violet-300",
};

export function getStatusLabel(status: AlphaStatus) {
  return STATUS_LABELS[status] || status;
}

export function getStatusColor(status: AlphaStatus) {
  return STATUS_COLORS[status] || "text-foreground";
}

export const VALID_TRANSITIONS: Record<AlphaStatus, AlphaStatus[]> = {
  candidate: ["validated", "rejected", "retired"],
  validated: ["retired"],
  rejected: ["candidate", "retired"],
  retired: [],
};

function readRegistryFile(): RegistryFile {
  if (!fs.existsSync(REGISTRY_PATH)) {
    return { version: 1, updated_at: "", entries: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) as RegistryFile;
  } catch {
    return { version: 1, updated_at: "", entries: {} };
  }
}

export function listAlphaRecords(): AlphaRecord[] {
  const raw = readRegistryFile();
  return Object.values(raw.entries).sort(
    (a, b) => Date.parse(b.updated_at || "0") - Date.parse(a.updated_at || "0")
  );
}

export function getAlphaRecord(id: string): AlphaRecord | null {
  const safe = id.replace(/[^a-zA-Z0-9:._-]/g, "");
  return readRegistryFile().entries[safe] || null;
}

export function getRegistrySummary() {
  const records = listAlphaRecords();
  const by_status: Record<string, number> = {};
  for (const r of records) {
    by_status[r.status] = (by_status[r.status] || 0) + 1;
  }
  const raw = readRegistryFile();
  const meta = (raw as RegistryFile & { meta?: Record<string, unknown> }).meta || {};
  return {
    total: records.length,
    by_status,
    validated_for_bot_review: records.filter((r) => r.status === "validated").map((r) => r.registry_id),
    registry_path: REGISTRY_PATH,
    updated_at: raw.updated_at,
    meta,
  };
}

function getPythonForRegistry(): string {
  const msb = path.join(process.cwd(), "microstructure_bot", ".venv", "Scripts", "python.exe");
  if (fs.existsSync(msb)) return msb;
  const eil = path.join(process.cwd(), "execution_intelligence_lab", ".venv", "Scripts", "python.exe");
  if (fs.existsSync(eil)) return eil;
  return "python";
}

export function runRegistryIngest(lab: "all" | "microstructure_bot" | "execution_intelligence_lab" = "all"): Promise<{
  ok: boolean;
  message: string;
}> {
  return new Promise((resolve) => {
    const python = getPythonForRegistry();
    const args = ["-m", "alpha_registry", "ingest", "--lab", lab];
    const child = spawn(python, args, {
      cwd: process.cwd(),
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, message: "Ingest завершён — записи обновлены из study JSON" });
      } else {
        resolve({ ok: false, message: (stderr || stdout || `Ingest failed (exit ${code})`).trim() });
      }
    });
    child.on("error", (e) => resolve({ ok: false, message: e.message }));
  });
}

export function runRegistrySetStatus(
  registryId: string,
  status: AlphaStatus,
  note: string
): Promise<{ ok: boolean; message: string; proposalPath?: string }> {
  return new Promise((resolve) => {
    const python = getPythonForRegistry();
    const args = ["-m", "alpha_registry", "set-status", registryId, status, "--note", note];
    const child = spawn(python, args, { cwd: process.cwd(), windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (code === 0) {
        const proposal =
          status === "validated"
            ? path.join(process.cwd(), "alpha_registry", "proposals", "integration_proposal.md")
            : undefined;
        resolve({
          ok: true,
          message:
            status === "validated"
              ? "Validated. Создан integration_proposal.md (интеграция не выполняется автоматически)"
              : `Статус: ${status}`,
          proposalPath: proposal && fs.existsSync(proposal) ? proposal : undefined,
        });
      } else {
        resolve({ ok: false, message: stderr || stdout || `Failed (exit ${code})` });
      }
    });
    child.on("error", (e) => resolve({ ok: false, message: e.message }));
  });
}
