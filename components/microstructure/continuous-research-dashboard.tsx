"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart3,
  CheckCircle2,
  Circle,
  Clock,
  Database,
  FileText,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  Target,
  XCircle,
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  Radio,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TabId = "start" | "daily" | "weekly" | "reports";

interface MsbStatus {
  mode: string;
  job: {
    id: string;
    label: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    expectedMinutes: number;
  } | null;
  collectorRunning: boolean;
  jobCatalog: { id: string; label: string; expectedMinutes: number; continuous?: boolean }[];
  logTail: string;
  reports: { id: string; kind: string; generatedAt: string | null }[];
  daily: {
    healthy: boolean;
    issues: string[];
    historySpanDays: number;
    totalRows: number;
    checks: Record<string, boolean>;
    recommendations: string[];
    generatedAt: string | null;
  } | null;
  weekly: {
    generatedAt: string | null;
    hypothesesTested: number;
    acceptedCount: number;
    alphaCandidates: string[];
    dataSpanDays: number;
    comparisons: {
      id: string;
      accepted: boolean;
      comparison: Record<string, unknown>;
    }[];
    hasFinalConclusion: boolean;
  } | null;
  milestones: {
    historySpanDays: { current: number; target: number; met: boolean };
    orderbookRows: { current: number; target: number; met: boolean };
    weeklyCycles: { current: number; target: number; met: boolean };
    lastDaily: string | null;
    lastWeekly: string | null;
    hasAlphaCandidate: boolean;
    hasResearchConclusion: boolean;
  };
  hypotheses: string[];
}

const TABS: { id: TabId; label: string; icon: typeof Target }[] = [
  { id: "start", label: "С чего начать", icon: Target },
  { id: "daily", label: "Каждый день", icon: Database },
  { id: "weekly", label: "Каждую неделю", icon: FlaskConical },
  { id: "reports", label: "Отчёты", icon: FileText },
];

const START_STEPS = [
  {
    step: 1,
    title: "Запустите сборщик данных",
    when: "Сразу, один раз — оставьте работать 24/7",
    action: "Вкладка «Каждый день» → кнопка «Запустить сборщик»",
    wait: "Статус «Сборщик работает». В логе — сообщения о flush/rows.",
    done: "Появляются строки orderbook в ежедневном отчёте.",
    jobId: "collect",
  },
  {
    step: 2,
    title: "Ежедневная проверка",
    when: "Каждый день, ~2 мин",
    action: "«Каждый день» → «Запустить ежедневную проверку»",
    wait: "Статус задачи «Завершено». Откроется daily_report.",
    done: "Все 4 галочки зелёные (данные, пропуски, свежесть, объём).",
    jobId: "daily",
  },
  {
    step: 3,
    title: "Еженедельное исследование",
    when: "Раз в 7 дней, ~15 мин",
    action: "«Каждую неделю» → «Запустить исследование 8 гипотез»",
    wait: "В логе — study для каждой гипотезы. Не закрывайте сервер.",
    done: "weekly_report_latest.md + сравнение с прошлой неделей.",
    jobId: "weekly",
  },
];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

function ProgressBar({ current, target, label }: { current: number; target: number; label: string }) {
  const pct = Math.min(100, Math.round((current / target) * 100));
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {current.toLocaleString()} / {target.toLocaleString()} ({pct}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-emerald-500" : "bg-cyan-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ContinuousResearchDashboard() {
  const [tab, setTab] = useState<TabId>("start");
  const [status, setStatus] = useState<MsbStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [reportMd, setReportMd] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/msb");
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
      const res = await fetch("/api/msb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: jobId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || data.message || "Ошибка запуска");
      } else {
        setMessage(data.message);
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
      const res = await fetch(`/api/msb/reports/${id}?format=md`);
      if (res.ok) setReportMd(await res.text());
      else {
        const j = await fetch(`/api/msb/reports/${id}`);
        if (j.ok) setReportMd(JSON.stringify(await j.json(), null, 2));
      }
    } catch {
      setReportMd(null);
    }
  };

  const jobRunning = status?.job?.status === "running";
  const m = status?.milestones;
  const collectorOn = status?.collectorRunning;

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-cyan-400">Continuous Research</p>
            <h2 className="mt-1 text-lg font-semibold">Платформа завершена · только накопление данных</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Параметры, критерии и признаки <strong className="font-medium text-foreground">не меняем</strong>.
              Каждый день — проверка сборщиков. Каждую неделю — 8 гипотез на новых данных. Стратегии в бота не
              добавляются автоматически.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {collectorOn ? (
              <span className="flex items-center gap-2 rounded-xl bg-emerald-500/15 px-3 py-2 text-sm text-emerald-200">
                <Radio className="h-4 w-4 animate-pulse" />
                Сборщик работает
              </span>
            ) : (
              <span className="flex items-center gap-2 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                Сборщик не запущен
              </span>
            )}
            {jobRunning && (
              <span className="flex items-center gap-2 rounded-xl bg-cyan-500/15 px-3 py-2 text-sm text-cyan-200">
                <Loader2 className="h-4 w-4 animate-spin" />
                {status?.job?.label}
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={() => fetchStatus()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {status?.daily && (
          <div
            className={cn(
              "mt-4 rounded-xl border p-4 text-sm",
              status.daily.healthy
                ? "border-emerald-500/20 bg-emerald-500/5"
                : "border-amber-500/20 bg-amber-500/5"
            )}
          >
            <p className="font-medium">
              Последняя ежедневная проверка: {formatDate(status.daily.generatedAt)}
              {status.daily.healthy ? " — всё в порядке" : " — есть проблемы"}
            </p>
            {!status.daily.healthy && status.daily.issues[0] && (
              <p className="mt-1 text-muted-foreground">{status.daily.issues[0]}</p>
            )}
          </div>
        )}

        {status?.milestones?.hasAlphaCandidate && (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
            <p className="font-medium text-emerald-200">Обнаружен alpha candidate</p>
            <p className="mt-1 text-muted-foreground">
              Откройте <code className="text-xs">alpha_candidate.md</code> во вкладке «Отчёты». Paper trading — вручную.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition-all",
              tab === t.id
                ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {message && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-muted-foreground">
          {message}
        </div>
      )}

      <AnimatePresence mode="wait">
        {tab === "start" && (
          <motion.div key="start" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            <section className="rounded-2xl border border-white/10 bg-black/40 p-5">
              <h3 className="flex items-center gap-2 font-semibold">
                <BarChart3 className="h-5 w-5 text-cyan-400" />
                Прогресс накопления
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Исследование имеет смысл после достаточной истории. Цели ниже — ориентир, не меняют критерии отбора.
              </p>
              <div className="mt-4 space-y-4">
                {m && (
                  <>
                    <ProgressBar
                      current={m.historySpanDays.current}
                      target={m.historySpanDays.target}
                      label="Дней истории (orderbook)"
                    />
                    <ProgressBar
                      current={m.orderbookRows.current}
                      target={m.orderbookRows.target}
                      label="Строк orderbook (все символы)"
                    />
                    <ProgressBar
                      current={m.weeklyCycles.current}
                      target={m.weeklyCycles.target}
                      label="Еженедельных циклов"
                    />
                  </>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="font-semibold">Три шага для новичка</h3>
              {START_STEPS.map((s) => (
                <div key={s.step} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/20 text-sm font-bold text-cyan-300">
                      {s.step}
                    </span>
                    <div>
                      <p className="font-medium">{s.title}</p>
                      <p className="text-xs text-cyan-300/80">{s.when}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-lg bg-white/5 p-3">
                      <p className="text-xs text-muted-foreground">Куда нажать</p>
                      <p className="mt-1">{s.action}</p>
                    </div>
                    <div className="rounded-lg bg-white/5 p-3">
                      <p className="text-xs text-muted-foreground">Что ждать</p>
                      <p className="mt-1">{s.wait}</p>
                    </div>
                    <div className="rounded-lg bg-white/5 p-3">
                      <p className="text-xs text-muted-foreground">Готово когда</p>
                      <p className="mt-1">{s.done}</p>
                    </div>
                  </div>
                  <Button
                    className="mt-3"
                    size="sm"
                    disabled={running || jobRunning}
                    onClick={() => {
                      runJob(s.jobId);
                      setTab(s.jobId === "weekly" ? "weekly" : "daily");
                    }}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    Запустить шаг {s.step}
                  </Button>
                </div>
              ))}
            </section>

            <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm">
              <p className="font-medium">8 гипотез (без изменений)</p>
              <p className="mt-2 flex flex-wrap gap-2">
                {status?.hypotheses.map((h) => (
                  <span key={h} className="rounded-lg bg-white/10 px-2 py-1 text-xs font-mono">
                    {h}
                  </span>
                ))}
              </p>
            </section>
          </motion.div>
        )}

        {tab === "daily" && (
          <motion.div key="daily" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <ActionCard
              title="1. Сборщик данных"
              subtitle="Работает непрерывно — не останавливайте без необходимости"
              hint="OKX WebSocket → Parquet. Оставьте Next.js/терминал запущенным."
              jobId="collect"
              running={running || jobRunning}
              active={collectorOn}
              activeLabel="Сборщик уже работает"
              onRun={runJob}
              expected="∞ (пока не остановите)"
            />
            <ActionCard
              title="2. Ежедневная проверка"
              subtitle="Качество · пропуски · объём · свежесть"
              hint="Создаёт daily_report.json и daily_report.md"
              jobId="daily"
              running={running || jobRunning}
              onRun={runJob}
              expected="~2 мин"
            />

            {status?.daily && (
              <section className="rounded-2xl border border-white/10 bg-black/40 p-5">
                <h3 className="font-semibold">Результат последней проверки</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {Object.entries(status.daily.checks).map(([key, ok]) => (
                    <div key={key} className="flex items-center gap-2 text-sm">
                      {ok ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <XCircle className="h-4 w-4 text-amber-400" />
                      )}
                      <span>{checkLabel(key)}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  История: {status.daily.historySpanDays} дн. · Строк: {status.daily.totalRows.toLocaleString()}
                </p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => loadReport("daily_report")}>
                  <FileText className="mr-2 h-4 w-4" />
                  Открыть daily_report
                </Button>
              </section>
            )}

            <LogPanel log={status?.logTail || ""} />
          </motion.div>
        )}

        {tab === "weekly" && (
          <motion.div key="weekly" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <ActionCard
              title="Еженедельное исследование"
              subtitle="Все 8 гипотез · только новые данные · сравнение с прошлой неделей"
              hint="Не меняет параметры. При первом прохождении — alpha_candidate.md"
              jobId="weekly"
              running={running || jobRunning}
              onRun={runJob}
              expected="~15 мин"
            />

            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
              <p className="font-medium">После исследования смотрите:</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
                <li>Улучшилась ли статистическая значимость (bootstrap p)</li>
                <li>Увеличилось ли число событий</li>
                <li>Изменились ли Expectancy и Profit Factor</li>
                <li>Появились ли новые закономерности в сравнении</li>
              </ul>
            </div>

            {status?.weekly && (
              <section className="rounded-2xl border border-white/10 bg-black/40 p-5">
                <h3 className="font-semibold">
                  Последний цикл: {formatDate(status.weekly.generatedAt)}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Принято: {status.weekly.acceptedCount} / {status.weekly.hypothesesTested} · Данных:{" "}
                  {status.weekly.dataSpanDays} дн.
                </p>
                <div className="mt-4 space-y-3">
                  {status.weekly.comparisons.map((c) => (
                    <ComparisonRow key={c.id} id={c.id} accepted={c.accepted} comparison={c.comparison} />
                  ))}
                </div>
                <Button variant="secondary" size="sm" className="mt-4" onClick={() => loadReport("weekly_report_latest")}>
                  Полный weekly отчёт
                </Button>
              </section>
            )}

            {m?.hasResearchConclusion && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
                <p className="font-medium">Итоговый вывод доступен</p>
                <Button variant="secondary" size="sm" className="mt-2" onClick={() => loadReport("research_conclusion")}>
                  research_conclusion.md
                </Button>
              </div>
            )}

            <LogPanel log={status?.logTail || ""} />
          </motion.div>
        )}

        {tab === "reports" && (
          <motion.div key="reports" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-white/10 bg-black/40 p-5">
              <h3 className="font-semibold">Файлы отчётов</h3>
              <div className="mt-3 max-h-96 space-y-1 overflow-y-auto">
                {status?.reports.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => loadReport(r.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/5",
                      selectedReport === r.id && "bg-cyan-500/10"
                    )}
                  >
                    <span className="truncate font-mono text-xs">{r.id}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{r.kind}</span>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <QuickReport label="daily_report" onClick={() => loadReport("daily_report")} />
                <QuickReport label="weekly_report_latest" onClick={() => loadReport("weekly_report_latest")} />
                <QuickReport label="alpha_candidate" onClick={() => loadReport("alpha_candidate")} />
              </div>
            </section>
            <section className="rounded-2xl border border-white/10 bg-black/40 p-5">
              <h3 className="font-semibold">Просмотр</h3>
              {reportMd ? (
                <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg bg-black/60 p-4 text-xs">
                  {reportMd}
                </pre>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Выберите отчёт слева</p>
              )}
              {selectedReport && (
                <a
                  href={`/api/msb/reports/${selectedReport}?format=md`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline"
                >
                  Открыть в новой вкладке <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function checkLabel(key: string) {
  const map: Record<string, string> = {
    collector_data_present: "Данные собираются",
    no_gaps: "Нет пропусков дней",
    not_stale: "Данные свежие",
    min_volume: "Достаточный объём",
  };
  return map[key] || key;
}

function ActionCard({
  title,
  subtitle,
  hint,
  jobId,
  running,
  active,
  activeLabel,
  onRun,
  expected,
}: {
  title: string;
  subtitle: string;
  hint: string;
  jobId: string;
  running: boolean;
  active?: boolean;
  activeLabel?: string;
  onRun: (id: string) => void;
  expected: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
      <p className="mt-2 text-xs text-cyan-300/70">{hint}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={running || active} onClick={() => onRun(jobId)}>
          {active ? (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {activeLabel}
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Запустить
            </>
          )}
        </Button>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {expected}
        </span>
      </div>
    </div>
  );
}

function ComparisonRow({
  id,
  accepted,
  comparison,
}: {
  id: string;
  accepted: boolean;
  comparison: Record<string, unknown>;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/5 p-3 text-sm">
      <div className="flex items-center gap-2">
        {accepted ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="font-mono font-medium">{id}</span>
        {accepted && <span className="text-xs text-emerald-400">ACCEPTED</span>}
      </div>
      {Boolean(comparison.has_previous) ? (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          <li>
            Значимость ↑:{" "}
            {comparison.significance_improved === true
              ? "да"
              : comparison.significance_improved === false
                ? "нет"
                : "—"}
          </li>
          <li>
            Событий больше:{" "}
            {comparison.events_increased === true ? "да" : comparison.events_increased === false ? "нет" : "—"}
            {comparison.events_delta != null ? ` (Δ ${String(comparison.events_delta)})` : ""}
          </li>
          <li>Δ Expectancy: {String(comparison.expectancy_delta ?? "—")}</li>
          <li>Δ Profit Factor: {String(comparison.profit_factor_delta ?? "—")}</li>
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Первый цикл — сравнение на следующей неделе</p>
      )}
    </div>
  );
}

function LogPanel({ log }: { log: string }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-black/40 p-5">
      <h4 className="mb-2 text-sm font-medium text-muted-foreground">Лог (continuous.log)</h4>
      <pre className="max-h-48 overflow-auto rounded-lg bg-black/60 p-3 text-xs text-muted-foreground">
        {log || "Пусто — запустите любую задачу"}
      </pre>
    </section>
  );
}

function QuickReport({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-white/10 px-2 py-1 text-xs hover:bg-white/5"
    >
      {label}
    </button>
  );
}
