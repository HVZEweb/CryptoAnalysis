"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Archive,
  BarChart3,
  CheckCircle2,
  Circle,
  Clock,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  Shield,
  Target,
  XCircle,
  AlertTriangle,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TabId = "plan" | "actions" | "reports" | "compare";

interface ReportMeta {
  id: string;
  kind: string;
  generatedAt: string | null;
  hasPair: boolean;
}

interface Milestones {
  fundingDays: { current: number; target: number; met: boolean };
  oiDays: { current: number; target: number; met: boolean };
  lastArchiveRun: string | null;
}

interface MaintenanceStatus {
  job: {
    id: string;
    label: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    expectedMinutes: number;
    exitCode: number | null;
  } | null;
  jobCatalog: { id: string; label: string; expectedMinutes: number }[];
  logTail: string;
  reports: ReportMeta[];
  latestPhaseX: ReportMeta | null;
  phaseXSummary: {
    finalVerdict: string;
    accepted: number | null;
    discoveryReady: boolean;
    sourcesPresent: number;
    sourcesTotal: number;
    qualityPassed: number;
    qualityTotal: number;
    retryAfter: string[];
  } | null;
  milestones: Milestones;
  baseline: { date: string; accepted: number; note: string };
}

const TABS: { id: TabId; label: string; icon: typeof Target }[] = [
  { id: "plan", label: "План", icon: Target },
  { id: "actions", label: "Действия", icon: Play },
  { id: "reports", label: "Отчёты", icon: FileText },
  { id: "compare", label: "Сравнение", icon: BarChart3 },
];

const PLAN_STEPS = [
  {
    phase: "Фаза 1 — Ежедневно",
    when: "Каждый день, ~1 мин",
    action: "Запустить «Ежедневный архив»",
    wait: "Статус → «Завершено». Funding, OI, trades, ticker дополняются.",
    done: "last_archive_run обновлён, quality passed растёт",
  },
  {
    phase: "Фаза 2 — Накопление",
    when: "30+ дней funding, 7+ дней OI",
    action: "Только архив — кнопки Phase X не нажимать часто",
    wait: "В плане: прогресс-бары funding/OI → 100%",
    done: "Оба milestone «выполнено»",
  },
  {
    phase: "Фаза 3 — Аудит",
    when: "Раз в 1–2 недели, ~3 сек",
    action: "«Coverage + Quality»",
    wait: "Отчёт coverage_report_*.json, discovery_ready=true",
    done: "Quality: все критичные источники OK",
  },
  {
    phase: "Фаза 4 — Phase X",
    when: "После фазы 2, ~35 мин",
    action: "«Полный Phase X + Discovery»",
    wait: "Не закрывать вкладку. Следить за логом.",
    done: "phase_x_report_*.html появился в отчётах",
  },
  {
    phase: "Фаза 5 — Решение",
    when: "После каждого Phase X",
    action: "Вкладка «Сравнение»",
    wait: "accepted = 0 → продолжаем архив. accepted > 0 → proposal вручную",
    done: "Edge найден ИЛИ честный финальный отчёт без edge",
  },
];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function ProgressBar({ current, target, label }: { current: number; target: number; label: string }) {
  const pct = Math.min(100, Math.round((current / target) * 100));
  const met = current >= target;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={met ? "text-emerald-400" : "text-amber-300"}>
          {current.toFixed(1)} / {target} дн. ({pct}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn("h-full rounded-full transition-all", met ? "bg-emerald-500" : "bg-amber-500/80")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function MaintenanceDashboard() {
  const [tab, setTab] = useState<TabId>("plan");
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [reportData, setReportData] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/maintenance");
      if (res.ok) setStatus(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, status?.job?.status === "running" ? 3000 : 10000);
    return () => clearInterval(interval);
  }, [fetchStatus, status?.job?.status]);

  const runJob = async (jobId: string) => {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: jobId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || data.message || "Ошибка запуска");
      } else {
        setMessage(data.message);
        setTab("actions");
      }
      await fetchStatus();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setRunning(false);
    }
  };

  const loadReport = async (id: string) => {
    setSelectedReport(id);
    try {
      const res = await fetch(`/api/maintenance/reports/${id}`);
      if (res.ok) setReportData(await res.json());
    } catch {
      setReportData(null);
    }
  };

  const jobRunning = status?.job?.status === "running";
  const milestones = status?.milestones;
  const readyForPhaseX = milestones?.fundingDays.met && milestones?.oiDays.met;
  const summary = status?.phaseXSummary;

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-violet-400">Maintenance Mode</p>
            <h2 className="mt-1 text-lg font-semibold">Платформа завершена · только сопровождение</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Торговую логику не меняем. Ежедневно — архив. Периодически — Phase X. Результаты не внедряются в бота
              автоматически.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {jobRunning ? (
              <span className="flex items-center gap-2 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-200">
                <Loader2 className="h-4 w-4 animate-spin" />
                {status?.job?.label}
              </span>
            ) : (
              <span className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Готов к задачам
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={() => fetchStatus()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {summary && (
          <div className="mt-4 rounded-xl border border-white/5 bg-white/5 p-4 text-sm">
            <p className="font-medium text-foreground">Последний Phase X</p>
            <p className="mt-1 text-muted-foreground line-clamp-2">{summary.finalVerdict}</p>
            <p className="mt-2 text-xs">
              Accepted: <span className={summary.accepted ? "text-emerald-400" : "text-muted-foreground"}>{summary.accepted ?? "—"}</span>
              {" · "}Данные: {summary.sourcesPresent}/{summary.sourcesTotal}
              {" · "}Quality: {summary.qualityPassed}/{summary.qualityTotal}
            </p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition-all",
              tab === t.id
                ? "border-violet-500/50 bg-violet-500/15 text-violet-200"
                : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === "plan" && (
          <motion.div key="plan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            <section className="rounded-2xl border border-white/10 bg-black/40 p-5">
              <h3 className="flex items-center gap-2 font-semibold">
                <Target className="h-5 w-5 text-violet-400" />
                Прогресс накопления данных
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Phase X с полным discovery имеет смысл после достижения целей ниже.
              </p>
              <div className="mt-4 space-y-4">
                {milestones && (
                  <>
                    <ProgressBar
                      current={milestones.fundingDays.current}
                      target={milestones.fundingDays.target}
                      label="Funding history (все символы)"
                    />
                    <ProgressBar
                      current={milestones.oiDays.current}
                      target={milestones.oiDays.target}
                      label="Open Interest 5m"
                    />
                  </>
                )}
                <p className="text-xs text-muted-foreground">
                  Последний архив: {formatDate(milestones?.lastArchiveRun ?? null)}
                </p>
                {!readyForPhaseX && (
                  <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-100/90">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Полный Phase X сейчас даст тот же результат (0 accepted). Сначала накапливайте данные через
                      ежедневный архив.
                    </span>
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="font-semibold">Дорожная карта</h3>
              {PLAN_STEPS.map((step, i) => (
                <div
                  key={step.phase}
                  className="rounded-2xl border border-white/10 bg-black/30 p-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/20 text-sm font-bold text-violet-300">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-medium">{step.phase}</p>
                      <p className="text-xs text-violet-300/80">{step.when}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-lg bg-white/5 p-3">
                      <p className="text-xs text-muted-foreground">Что нажать</p>
                      <p className="mt-1">{step.action}</p>
                    </div>
                    <div className="rounded-lg bg-white/5 p-3">
                      <p className="text-xs text-muted-foreground">Что ждать</p>
                      <p className="mt-1">{step.wait}</p>
                    </div>
                    <div className="rounded-lg bg-white/5 p-3">
                      <p className="text-xs text-muted-foreground">Критерий завершения</p>
                      <p className="mt-1">{step.done}</p>
                    </div>
                  </div>
                </div>
              ))}
            </section>

            <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm">
              <p className="font-medium text-emerald-300">Когда проект «завершён» по исследованию?</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
                <li>
                  <strong className="text-foreground">Успех:</strong> accepted ≥ 1 в Phase X → оформить proposal, ручной review
                </li>
                <li>
                  <strong className="text-foreground">Честный финал:</strong> после 30+ дн. данных и Phase X снова 0 accepted →
                  зафиксировать отсутствие edge
                </li>
                <li>До этого — режим сопровождения: архив каждый день, Phase X раз в 1–2 недели</li>
              </ul>
            </section>
          </motion.div>
        )}

        {tab === "actions" && (
          <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              {[
                {
                  id: "archive",
                  title: "1. Ежедневный архив",
                  desc: "Funding, OI, trades, ticker. Без L2. ~1 мин.",
                  when: "Каждый день",
                  expect: "Archive complete, manifest обновлён",
                  icon: Archive,
                  primary: true,
                },
                {
                  id: "archive-l2",
                  title: "1b. Архив + L2",
                  desc: "Дополнительно orderbook снимки ~2 мин × 3 символа.",
                  when: "1–2 раза в неделю",
                  expect: "orderbook CSV растёт",
                  icon: Archive,
                  primary: false,
                },
                {
                  id: "coverage",
                  title: "2. Coverage + Quality",
                  desc: "Быстрый аудит данных. Discovery не запускается.",
                  when: "Раз в 1–2 недели",
                  expect: "coverage_report_*.json за ~3 сек",
                  icon: BarChart3,
                  primary: false,
                },
                {
                  id: "phase-x",
                  title: "3. Полный Phase X",
                  desc: "Coverage + quality + discovery на 103k баров.",
                  when: "После 30д funding + 7д OI",
                  expect: "phase_x_report_*.html за ~35 мин",
                  icon: Target,
                  primary: false,
                  disabled: !readyForPhaseX,
                },
              ].map((action) => (
                <div
                  key={action.id}
                  className={cn(
                    "rounded-2xl border p-5",
                    action.primary ? "border-violet-500/30 bg-violet-500/5" : "border-white/10 bg-black/40"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <action.icon className="h-6 w-6 shrink-0 text-violet-400" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{action.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{action.desc}</p>
                      <p className="mt-2 text-xs">
                        <Clock className="mr-1 inline h-3 w-3" />
                        {action.when}
                      </p>
                      <p className="mt-1 text-xs text-emerald-300/80">Ожидайте: {action.expect}</p>
                    </div>
                  </div>
                  <Button
                    className="mt-4 w-full"
                    variant={action.primary ? "default" : "secondary"}
                    disabled={running || jobRunning || action.disabled}
                    onClick={() => runJob(action.id)}
                  >
                    {running || jobRunning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Запустить
                  </Button>
                  {action.disabled && (
                    <p className="mt-2 text-xs text-amber-300">Сначала накопите funding 30д и OI 7д (см. План)</p>
                  )}
                </div>
              ))}
            </div>

            {message && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">{message}</div>
            )}

            {status?.job && (
              <section className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <h4 className="font-medium">Текущая задача</h4>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  <span>{status.job.label}</span>
                  <span
                    className={cn(
                      status.job.status === "completed" && "text-emerald-400",
                      status.job.status === "failed" && "text-red-400",
                      status.job.status === "running" && "text-amber-300"
                    )}
                  >
                    {status.job.status === "running" && "Выполняется…"}
                    {status.job.status === "completed" && "Завершено"}
                    {status.job.status === "failed" && `Ошибка (code ${status.job.exitCode})`}
                  </span>
                  <span className="text-muted-foreground">~{status.job.expectedMinutes} мин</span>
                </div>
              </section>
            )}

            {status?.logTail && (
              <section className="rounded-2xl border border-white/10 bg-black/60 p-4">
                <h4 className="mb-2 text-sm font-medium text-muted-foreground">Лог (maintenance.log)</h4>
                <pre className="max-h-48 overflow-auto text-xs text-zinc-400">{status.logTail}</pre>
              </section>
            )}
          </motion.div>
        )}

        {tab === "reports" && (
          <motion.div key="reports" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <h3 className="font-semibold">Список отчётов</h3>
                <p className="mt-1 text-xs text-muted-foreground">bot/alpha/results/</p>
                <div className="mt-3 max-h-96 space-y-1 overflow-auto">
                  {loading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
                  {status?.reports.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => loadReport(r.id)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/10",
                        selectedReport === r.id && "bg-violet-500/15"
                      )}
                    >
                      <span>
                        <span className="font-medium">{r.kind}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{formatDate(r.generatedAt)}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <h3 className="font-semibold">Просмотр</h3>
                {selectedReport ? (
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={`/api/maintenance/reports/${selectedReport}?format=html`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                      >
                        <ExternalLink className="h-3 w-3" />
                        HTML в новой вкладке
                      </a>
                    </div>
                    {reportData && (
                      <pre className="max-h-80 overflow-auto rounded-lg bg-black/60 p-3 text-xs text-zinc-400">
                        {JSON.stringify(
                          reportData.final_verdict
                            ? {
                                final_verdict: reportData.final_verdict,
                                accepted: (reportData.discovery as Record<string, unknown>)?.accepted,
                                coverage: (reportData.coverage as Record<string, unknown>)?.summary,
                                quality: {
                                  passed: (reportData.quality as Record<string, unknown>)?.passed,
                                  failed: (reportData.quality as Record<string, unknown>)?.failed,
                                },
                              }
                            : reportData,
                          null,
                          2
                        )}
                      </pre>
                    )}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">Выберите отчёт слева</p>
                )}
              </section>
            </div>
          </motion.div>
        )}

        {tab === "compare" && (
          <motion.div key="compare" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <section className="rounded-2xl border border-white/10 bg-black/40 p-5">
              <h3 className="font-semibold">Baseline vs последний прогон</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase text-muted-foreground">Baseline ({status?.baseline.date})</p>
                  <p className="mt-2 text-2xl font-bold">{status?.baseline.accepted}</p>
                  <p className="text-sm text-muted-foreground">accepted гипотез</p>
                  <p className="mt-2 text-xs">{status?.baseline.note}</p>
                </div>
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                  <p className="text-xs uppercase text-muted-foreground">Последний Phase X</p>
                  <p className="mt-2 text-2xl font-bold">{summary?.accepted ?? "—"}</p>
                  <p className="text-sm text-muted-foreground">accepted гипотез</p>
                  {summary && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Quality {summary.qualityPassed}/{summary.qualityTotal} · Data {summary.sourcesPresent}/
                      {summary.sourcesTotal}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-6 space-y-2">
                <p className="text-sm font-medium">Что сравнивать вручную:</p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    {summary?.accepted === 0 ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4" />
                    )}
                    accepted — стабильно 0 = edge пока нет
                  </li>
                  <li className="flex items-start gap-2">
                    <Circle className="mt-0.5 h-4 w-4" />
                    funding/OI span_days в manifest — должны расти
                  </li>
                  <li className="flex items-start gap-2">
                    <Circle className="mt-0.5 h-4 w-4" />
                    rejection_reasons — не должны меняться хаотично
                  </li>
                </ul>
              </div>

              {summary && (summary.accepted ?? 0) > 0 && (
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-500/15 p-4 text-sm">
                  <AlertTriangle className="h-5 w-5 text-emerald-400" />
                  <div>
                    <p className="font-medium text-emerald-300">Обнаружена закономерность!</p>
                    <p className="mt-1 text-muted-foreground">
                      Создайте bot/alpha/results/proposal_YYYYMMDD.md и предложите к ручному review. Не внедряйте в
                      бота автоматически.
                    </p>
                  </div>
                </div>
              )}

              {summary?.retryAfter && summary.retryAfter.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium">Повторить после накопления:</p>
                  <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
                    {summary.retryAfter.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-center text-xs text-muted-foreground">
        Подробности:{" "}
        <Link href="/spread" className="text-violet-400 hover:underline">
          Trading Bot
        </Link>
        {" · "}
        Документация: bot/MAINTENANCE.md
      </p>
    </div>
  );
}
