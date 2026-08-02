"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookMarked,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  FileText,
  History,
  Loader2,
  RefreshCw,
  Shield,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AlphaStatus = "candidate" | "validated" | "rejected" | "retired";

interface AlphaRecord {
  registry_id: string;
  source_lab: string;
  hypothesis_id: string;
  title: string;
  description: string;
  economic_rationale: string;
  status: AlphaStatus;
  bot_integration_eligible: boolean;
  limitations: string[];
  overfitting_risk: string;
  registered_at: string;
  updated_at: string;
  data: {
    symbols: string[];
    orderbook_rows: number;
    trade_rows: number;
    events_total: number;
    study_generated_at: string | null;
    study_file: string | null;
  };
  validation: {
    oos_pass: boolean;
    walk_forward_stable: boolean;
    bootstrap_p_min: number | null;
    cross_symbol_pass: boolean;
    study_accepted: boolean;
  };
  metrics: {
    expectancy_pct: number | null;
    profit_factor: number | null;
    horizon_sec: number | null;
  };
  history: {
    at: string;
    action: string;
    from_status: string | null;
    to_status: string | null;
    note: string;
    actor: string;
  }[];
}

interface RegistryData {
  summary: {
    total: number;
    by_status: Record<string, number>;
    validated_for_bot_review: string[];
    updated_at: string;
  };
  records: AlphaRecord[];
  workflow: { steps: string[]; bot_rule: string };
}

const STATUS_STYLES: Record<AlphaStatus, { label: string; className: string }> = {
  candidate: { label: "Candidate", className: "bg-amber-500/15 text-amber-200 border-amber-500/30" },
  validated: { label: "Validated", className: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30" },
  rejected: { label: "Rejected", className: "bg-white/5 text-muted-foreground border-white/10" },
  retired: { label: "Retired", className: "bg-violet-500/15 text-violet-200 border-violet-500/30" },
};

const NEXT_STATUS: Record<AlphaStatus, { status: AlphaStatus; label: string }[]> = {
  candidate: [
    { status: "validated", label: "→ Validated (допуск к review бота)" },
    { status: "rejected", label: "→ Rejected" },
    { status: "retired", label: "→ Retired" },
  ],
  validated: [{ status: "retired", label: "→ Retired" }],
  rejected: [
    { status: "candidate", label: "→ Candidate (повторный review)" },
    { status: "retired", label: "→ Retired" },
  ],
  retired: [],
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

export function AlphaRegistryDashboard() {
  const [data, setData] = useState<RegistryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<AlphaStatus | "all">("all");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/alpha-registry");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const postAction = async (body: Record<string, string>) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/alpha-registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) setMessage(json.error || json.message || "Ошибка");
      else {
        setMessage(json.message);
        if (json.records) setData((d) => (d ? { ...d, records: json.records, summary: json.summary } : d));
        else await fetchData();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setBusy(false);
    }
  };

  const records = (data?.records || []).filter((r) => filter === "all" || r.status === filter);
  const selectedRecord = records.find((r) => r.registry_id === selected) || data?.records.find((r) => r.registry_id === selected);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-indigo-400">Alpha Registry</p>
            <h2 className="mt-1 text-lg font-semibold">Исследование → регистрация → ручное решение</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Архитектура завершена. EIL → MSB → Registry → Manual Review → PR → Bot.
              {data?.workflow.bot_rule}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => fetchData()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {summary && (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {(["candidate", "validated", "rejected", "retired"] as AlphaStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={cn(
                  "rounded-xl border p-3 text-left transition-all",
                  STATUS_STYLES[s].className,
                  filter === s && "ring-2 ring-indigo-500/50"
                )}
              >
                <p className="text-2xl font-bold">{summary.by_status[s] || 0}</p>
                <p className="text-xs">{STATUS_STYLES[s].label}</p>
              </button>
            ))}
          </div>
        )}

        {summary && summary.validated_for_bot_review.length > 0 && (
          <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm">
            <p className="font-medium text-emerald-200">Допущены к review для бота ({summary.validated_for_bot_review.length})</p>
            <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
              {summary.validated_for_bot_review.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <a
          href="/api/alpha-registry/proposals/integration_proposal"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-white/10 px-3 py-1.5 hover:bg-white/5"
        >
          integration_proposal.md
        </a>
        <a
          href="/api/alpha-registry/proposals/final_research_conclusion"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-white/10 px-3 py-1.5 hover:bg-white/5"
        >
          final_research_conclusion.md
        </a>
      </div>

      <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ChevronRight className="h-4 w-4" />
          Процесс
        </h3>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-muted-foreground">
          {data?.workflow.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <Button
          className="mt-4"
          disabled={busy}
          onClick={() => postAction({ action: "ingest", lab: "all" })}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
          Ingest из лабораторий
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Читает последние study_*.json из MSB и EIL. Лаборатории не изменяются.
        </p>
      </div>

      {message && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm">{message}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-black/40 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Записи ({records.length})</h3>
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={cn("text-xs", filter === "all" ? "text-indigo-300" : "text-muted-foreground")}
            >
              Все
            </button>
          </div>
          <div className="max-h-[32rem] space-y-2 overflow-y-auto">
            {records.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Пусто. Запустите ingest после study в лаборатории.
              </p>
            ) : (
              records.map((r) => (
                <button
                  key={r.registry_id}
                  type="button"
                  onClick={() => setSelected(r.registry_id)}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left transition-colors",
                    selected === r.registry_id
                      ? "border-indigo-500/40 bg-indigo-500/10"
                      : "border-white/5 bg-white/5 hover:bg-white/10"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{r.registry_id}</span>
                    <span className={cn("rounded-lg border px-2 py-0.5 text-xs", STATUS_STYLES[r.status].className)}>
                      {STATUS_STYLES[r.status].label}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-sm">{r.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{r.source_lab}</p>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-black/40 p-5">
          {!selectedRecord ? (
            <p className="text-sm text-muted-foreground">Выберите запись слева</p>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div key={selectedRecord.registry_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <DetailPanel record={selectedRecord} busy={busy} onStatusChange={(status, note) =>
                  postAction({
                    action: "set-status",
                    registry_id: selectedRecord.registry_id,
                    status,
                    note,
                  })
                } />
              </motion.div>
            </AnimatePresence>
          )}
        </section>
      </div>
    </div>
  );
}

function DetailPanel({
  record,
  busy,
  onStatusChange,
}: {
  record: AlphaRecord;
  busy: boolean;
  onStatusChange: (status: AlphaStatus, note: string) => void;
}) {
  const v = record.validation;
  const m = record.metrics;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="font-semibold">{record.title}</h3>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{record.registry_id}</p>
      </div>

      {record.bot_integration_eligible && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-200">
          <Shield className="h-4 w-4" />
          Допущена к ручному рассмотрению для Unified Trading Bot
        </div>
      )}

      <p className="text-muted-foreground">{record.description}</p>

      <div className="grid gap-2 sm:grid-cols-2">
        <Metric ok={v.oos_pass} label="OOS" />
        <Metric ok={v.walk_forward_stable} label="Walk-forward" />
        <Metric ok={v.cross_symbol_pass} label="Cross-symbol" />
        <Metric
          ok={v.bootstrap_p_min != null && v.bootstrap_p_min < 0.05}
          label={`Bootstrap p=${v.bootstrap_p_min ?? "—"}`}
        />
      </div>

      <div className="rounded-lg bg-white/5 p-3 text-xs">
        <p>EV: {m.expectancy_pct ?? "—"}% · PF: {m.profit_factor ?? "—"} · H: {m.horizon_sec ?? "—"}s</p>
        <p className="mt-1 text-muted-foreground">
          Events: {record.data.events_total} · OB rows: {record.data.orderbook_rows.toLocaleString()}
        </p>
        <p className="mt-1 text-muted-foreground">Study: {record.data.study_file || "—"}</p>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground">Ограничения</p>
        <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
          {record.limitations.slice(0, 4).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {record.overfitting_risk && (
          <p className="mt-2 flex items-start gap-1 text-xs text-amber-200/80">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {record.overfitting_risk}
          </p>
        )}
      </div>

      {NEXT_STATUS[record.status].length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Ручное решение</p>
          {NEXT_STATUS[record.status].map((opt) => (
            <Button
              key={opt.status}
              variant="secondary"
              size="sm"
              disabled={busy}
              className="w-full justify-start"
              onClick={() => onStatusChange(opt.status, opt.label)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      )}

      <div>
        <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <History className="h-3 w-3" /> История
        </p>
        <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
          {[...record.history].reverse().map((h, i) => (
            <div key={`${h.at}-${i}`} className="rounded-lg bg-black/40 px-2 py-1.5 text-xs">
              <span className="text-muted-foreground">{fmtDate(h.at)}</span>
              {" · "}
              {h.from_status || "—"} → {h.to_status || "—"}
              <p className="text-muted-foreground">{h.note}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        Обновлено: {fmtDate(record.updated_at)}
      </p>
    </div>
  );
}

function Metric({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs">
      {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
      {label}
    </div>
  );
}
