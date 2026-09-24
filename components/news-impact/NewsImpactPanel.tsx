"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellOff,
  Filter,
  Flame,
  History,
  Loader2,
  Newspaper,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Shield,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImpactDetailPanel, ImpactSignalCard, isHotImpactSignal } from "@/components/news-impact/impact-signal-card";
import type {
  LlmLogEntry,
  NewsImpactAlert,
  NewsImpactHistoryRow,
  NewsImpactSignal,
  NewsImpactState,
} from "@/lib/news-impact/types";
import { cn } from "@/lib/utils";

type DirectionFilter = "all" | "LONG" | "SHORT" | "SIDEWAYS";
type UrgencyFilter = "all" | NewsImpactSignal["urgency"];

function formatInterval(ms: number): string {
  const sec = Math.round(ms / 1000);
  return sec >= 60 ? `${Math.round(sec / 60)} мин` : `${sec} сек`;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))} сек назад`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} мин назад`;
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function NewsImpactPanel() {
  const [state, setState] = useState<NewsImpactState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [coinFilter, setCoinFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>("all");
  const [minScore, setMinScore] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/news-impact?limit=30");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as NewsImpactState;
      setState(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  const runAction = useCallback(
    async (action: "start" | "stop" | "tick") => {
      setActionLoading(action);
      setError(null);
      try {
        const res = await fetch("/api/news-impact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { state: NewsImpactState; newImpacts?: NewsImpactSignal[] };
        setState(data.state);
        if (data.newImpacts?.length) {
          setSelectedId(data.newImpacts[0].newsId);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка действия");
      } finally {
        setActionLoading(null);
      }
    },
    []
  );

  const toggleAlerts = useCallback(async (enabled: boolean) => {
    setActionLoading("alerts");
    setError(null);
    try {
      const res = await fetch("/api/news-impact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_alerts", enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { state: NewsImpactState };
      setState(data.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка переключения алертов");
    } finally {
      setActionLoading(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!state?.running) return;
    const id = setInterval(() => void load(), Math.min(state.intervalMs, 30_000));
    return () => clearInterval(id);
  }, [state?.running, state?.intervalMs, load]);

  const coins = useMemo(() => {
    const set = new Set(state?.recentImpacts.map((i) => i.coin) ?? []);
    return ["all", ...[...set].sort()];
  }, [state?.recentImpacts]);

  const hotSignals = useMemo(() => {
    return (state?.recentImpacts ?? []).filter(isHotImpactSignal).slice(0, 6);
  }, [state?.recentImpacts]);

  const filtered = useMemo(() => {
    return (state?.recentImpacts ?? []).filter((s) => {
      if (coinFilter !== "all" && s.coin !== coinFilter) return false;
      if (directionFilter !== "all" && s.direction !== directionFilter) return false;
      if (urgencyFilter !== "all" && s.urgency !== urgencyFilter) return false;
      if (s.impactScore < minScore) return false;
      return true;
    });
  }, [state?.recentImpacts, coinFilter, directionFilter, urgencyFilter, minScore]);

  const selected =
    filtered.find((s) => s.newsId === selectedId) ??
    state?.recentImpacts.find((s) => s.newsId === selectedId) ??
    null;

  useEffect(() => {
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0].newsId);
    }
  }, [filtered, selectedId]);

  return (
    <div className="space-y-6">
      {/* Status + controls */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-xl",
                  state?.running
                    ? "bg-emerald-500/15 ring-1 ring-emerald-500/30"
                    : "bg-white/5 ring-1 ring-white/10"
                )}
              >
                <Radar
                  className={cn(
                    "h-5 w-5",
                    state?.running ? "text-emerald-400 animate-pulse" : "text-muted-foreground"
                  )}
                />
              </div>
              <div>
                <p className="font-display font-semibold">
                  {state?.running ? "Мониторинг активен" : "Мониторинг остановлен"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Интервал {formatInterval(state?.intervalMs ?? 60_000)} · последний тик{" "}
                  {formatRelativeTime(state?.lastTickAt ?? null)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                className={cn(
                  "rounded-xl",
                  state?.alertsEnabled && "border-amber-500/40 text-amber-200"
                )}
                disabled={actionLoading === "alerts"}
                onClick={() => void toggleAlerts(!state?.alertsEnabled)}
              >
                {actionLoading === "alerts" ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : state?.alertsEnabled ? (
                  <Bell className="mr-1 h-3.5 w-3.5" />
                ) : (
                  <BellOff className="mr-1 h-3.5 w-3.5" />
                )}
                Алерты {state?.alertsEnabled ? "ON" : "OFF"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="rounded-xl"
                disabled={!!actionLoading || state?.running}
                onClick={() => void runAction("start")}
              >
                {actionLoading === "start" ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="mr-1 h-3.5 w-3.5" />
                )}
                Старт
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="rounded-xl"
                disabled={!!actionLoading || !state?.running}
                onClick={() => void runAction("stop")}
              >
                {actionLoading === "stop" ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Pause className="mr-1 h-3.5 w-3.5" />
                )}
                Стоп
              </Button>
              <Button
                size="sm"
                className="rounded-xl bg-indigo-600 hover:bg-indigo-500"
                disabled={!!actionLoading}
                onClick={() => void runAction("tick")}
              >
                {actionLoading === "tick" ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                )}
                Сканировать
              </Button>
            </div>
          </div>

          {state?.lastError && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {state.lastError}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
          <StatCard label="Сигналов" value={state?.significantCount ?? 0} icon={Newspaper} />
          <StatCard label="Отфильтровано" value={state?.filteredCount ?? 0} icon={Shield} />
          <StatCard label="Обработано" value={state?.processedCount ?? 0} icon={Radar} />
          <StatCard label="В ленте" value={state?.lastFetchedCount ?? 0} icon={Filter} />
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Filter className="h-4 w-4 text-indigo-400" />
          Фильтры
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterPills
            label="Монета"
            value={coinFilter}
            options={coins}
            onChange={setCoinFilter}
          />
          <FilterPills
            label="Направление"
            value={directionFilter}
            options={["all", "LONG", "SHORT", "SIDEWAYS"]}
            onChange={(v) => setDirectionFilter(v as DirectionFilter)}
          />
          <FilterPills
            label="Срочность"
            value={urgencyFilter}
            options={["all", "Immediate", "Short", "Medium"]}
            onChange={(v) => setUrgencyFilter(v as UrgencyFilter)}
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <label className="text-xs text-muted-foreground">Мин. impact score</label>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="h-1.5 flex-1 accent-indigo-500"
          />
          <span className="w-8 text-right text-xs font-mono">{minScore}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {hotSignals.length > 0 && (
        <div className="rounded-2xl border border-red-500/20 bg-gradient-to-r from-red-500/[0.06] via-transparent to-emerald-500/[0.04] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-400" />
            <h2 className="font-display text-sm font-semibold">Hot Signals</h2>
            <span className="text-xs text-muted-foreground">High / Extreme · score ≥ 65</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {hotSignals.map((signal) => (
              <ImpactSignalCard
                key={`hot-${signal.newsId}`}
                signal={signal}
                hot
                selected={selectedId === signal.newsId}
                onSelect={() => setSelectedId(signal.newsId)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <RecentAlertsSection alerts={state?.recentAlerts ?? []} />
        <HistoricalPerformanceSection
          performance={state?.historyPerformance}
          history={state?.recentHistory ?? []}
        />
      </div>

      {loading && !state ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Загрузка News Impact…
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold">
                Лента сигналов ({filtered.length})
              </h2>
              <button
                type="button"
                onClick={() => void load()}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Обновить
              </button>
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center">
                <Newspaper className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Нет сигналов. Запустите мониторинг или нажмите «Сканировать».
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((signal) => (
                  <ImpactSignalCard
                    key={signal.newsId}
                    signal={signal}
                    selected={selectedId === signal.newsId}
                    onSelect={() => setSelectedId(signal.newsId)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <h2 className="mb-3 font-display text-sm font-semibold">Детали сигнала</h2>
            <ImpactDetailPanel signal={selected} />
            <LlmLogSection logs={state?.recentLlmLogs ?? []} />
          </div>
        </div>
      )}
    </div>
  );
}

function LlmLogSection({ logs }: { logs: LlmLogEntry[] }) {
  if (logs.length === 0) return null;

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="mb-2 font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        LLM журнал
      </h3>
      <ul className="max-h-48 space-y-2 overflow-y-auto text-xs">
        {logs.slice(0, 12).map((log) => (
          <li
            key={`${log.at}-${log.newsId}-${log.outcome}`}
            className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono text-[10px] uppercase",
                  log.outcome === "success" && "bg-emerald-500/15 text-emerald-300",
                  log.outcome === "skipped" && "bg-amber-500/15 text-amber-200",
                  log.outcome === "failed" && "bg-red-500/15 text-red-200"
                )}
              >
                {log.outcome}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {formatRelativeTime(log.at)}
              </span>
            </div>
            <p className="mt-1 line-clamp-1 text-muted-foreground">{log.title}</p>
            <p className="mt-0.5 font-mono text-[10px] text-indigo-200/80">{log.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentAlertsSection({ alerts }: { alerts: NewsImpactAlert[] }) {
  return (
    <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[0.03] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Bell className="h-4 w-4 text-amber-300" />
        <h2 className="font-display text-sm font-semibold">Recent Alerts</h2>
        <span className="text-xs text-muted-foreground">score ≥ 75 · Extreme / High+Immediate</span>
      </div>
      {alerts.length === 0 ? (
        <p className="text-xs text-muted-foreground">Пока нет отправленных алертов.</p>
      ) : (
        <ul className="max-h-52 space-y-2 overflow-y-auto">
          {alerts.slice(0, 10).map((alert) => (
            <li
              key={alert.id}
              className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  {alert.coin} {alert.direction} · {alert.impactScore}
                </span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px]",
                    alert.success ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-200"
                  )}
                >
                  {alert.success ? "sent" : "fail"}
                </span>
              </div>
              <p className="mt-1 line-clamp-1 text-muted-foreground">{alert.reason}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {formatRelativeTime(alert.at)} · {alert.channels.join(", ") || "—"}
                {alert.sectorLabel ? ` · ${alert.sectorLabel}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoricalPerformanceSection({
  performance,
  history,
}: {
  performance?: NewsImpactState["historyPerformance"];
  history: NewsImpactHistoryRow[];
}) {
  const perf = performance ?? {
    total: 0,
    withOutcome: 0,
    directionHitRate: 0,
    avgMove5m: 0,
    avgMove15m: 0,
    avgMove30m: 0,
    avgMove60m: 0,
    avgExpectedMove: 0,
  };

  return (
    <div className="rounded-2xl border border-indigo-500/15 bg-indigo-500/[0.03] p-4">
      <div className="mb-3 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-indigo-300" />
        <h2 className="font-display text-sm font-semibold">Historical Performance</h2>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white/5 p-2">
          <p className="font-display text-lg font-bold">{perf.directionHitRate}%</p>
          <p className="text-[10px] text-muted-foreground">hit rate</p>
        </div>
        <div className="rounded-lg bg-white/5 p-2">
          <p className="font-display text-lg font-bold">{perf.withOutcome}</p>
          <p className="text-[10px] text-muted-foreground">с outcome</p>
        </div>
        <div className="rounded-lg bg-white/5 p-2">
          <p className="font-display text-lg font-bold">~{perf.avgMove15m}%</p>
          <p className="text-[10px] text-muted-foreground">avg 15m</p>
        </div>
      </div>
      {history.length > 0 ? (
        <ul className="mt-3 max-h-40 space-y-1.5 overflow-y-auto text-xs">
          {history.slice(0, 8).map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/5 px-2 py-1.5"
            >
              <span className="truncate font-medium">
                {row.coin} · {row.predictedDirection}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {row.actualMove15m != null ? `${row.actualMove15m}%` : "—"} / exp {row.expectedMovePct}%
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <History className="h-3.5 w-3.5" />
          История накапливается после первых сигналов.
        </p>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="mt-1 font-display text-xl font-bold">{value}</p>
    </div>
  );
}

function FilterPills({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[10px] uppercase text-muted-foreground">{label}</span>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "rounded-lg px-2.5 py-1 text-xs transition-colors",
            value === opt
              ? "bg-indigo-500/20 text-indigo-100 ring-1 ring-indigo-500/30"
              : "bg-white/5 text-muted-foreground hover:bg-white/10"
          )}
        >
          {opt === "all" ? "Все" : opt}
        </button>
      ))}
    </div>
  );
}
