"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Loader2,
  RefreshCw,
  Shield,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  DriftAlert,
  MonitoringAlert,
  MonitoringAlertKind,
  PerformanceSnapshot,
  RetrainDecision,
  RetrainSchedulerState,
} from "@/lib/monitoring/types";
import { cn } from "@/lib/utils";

function alertKindLabel(kind: MonitoringAlertKind): string {
  switch (kind) {
    case "drift":
      return "Concept Drift";
    case "sharp_drop":
      return "Sharp Drop";
    case "regime_shift":
      return "Regime Shift";
  }
}

function MiniChart({
  data,
  color,
  valueKey,
}: {
  data: Array<Record<string, number | string>>;
  color: string;
  valueKey: string;
}) {
  if (data.length < 2) {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
        Недостаточно live данных
      </div>
    );
  }

  const values = data.map((d) => Number(d[valueKey]));
  const w = 360;
  const h = 72;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
    </svg>
  );
}

interface RetrainStatusPayload extends RetrainSchedulerState {
  decision: RetrainDecision;
}

export function LivePerformancePanel() {
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot | null>(null);
  const [driftAlerts, setDriftAlerts] = useState<DriftAlert[]>([]);
  const [alerts, setAlerts] = useState<MonitoringAlert[]>([]);
  const [alertHistory, setAlertHistory] = useState<MonitoringAlert[]>([]);
  const [retrainStatus, setRetrainStatus] = useState<RetrainStatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrainLoading, setRetrainLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrainMessage, setRetrainMessage] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const [perfRes, driftRes, alertsRes, retrainRes] = await Promise.all([
        fetch(`/api/monitoring/performance${refresh ? "?refresh=true" : ""}`),
        fetch("/api/monitoring/drift"),
        fetch("/api/monitoring/alerts"),
        fetch("/api/monitoring/retrain"),
      ]);

      if (!perfRes.ok) throw new Error("Performance API failed");
      const perfData = (await perfRes.json()) as { snapshot: PerformanceSnapshot };
      setSnapshot(perfData.snapshot);

      if (driftRes.ok) {
        const driftData = (await driftRes.json()) as { alerts: DriftAlert[] };
        setDriftAlerts(driftData.alerts ?? []);
      }

      if (alertsRes.ok) {
        const alertData = (await alertsRes.json()) as {
          active: MonitoringAlert[];
          history?: MonitoringAlert[];
        };
        setAlerts(alertData.active ?? []);
        setAlertHistory(alertData.history ?? []);
      }

      if (retrainRes.ok) {
        const data = (await retrainRes.json()) as { status: RetrainStatusPayload };
        setRetrainStatus(data.status);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const runRetrain = async (force = false) => {
    setRetrainLoading(true);
    setRetrainMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/monitoring/retrain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Retrain failed");

      if (data.skipped) {
        setRetrainMessage(`Skipped: ${data.decision?.reason ?? "not due"}`);
      } else if (data.run?.ok) {
        setRetrainMessage(
          `Retrain OK: ${data.run.samples} samples (backtest ${data.run.backtestSamples} + live ${data.run.liveSamples})`
        );
      } else {
        setRetrainMessage(`Retrain failed: ${data.run?.error ?? "unknown"}`);
      }

      const statusRes = await fetch("/api/monitoring/retrain");
      if (statusRes.ok) {
        const s = (await statusRes.json()) as { status: RetrainStatusPayload };
        setRetrainStatus(s.status);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retrain failed");
    } finally {
      setRetrainLoading(false);
    }
  };

  const criticalDrift = useMemo(
    () => driftAlerts.filter((a) => a.dropPct >= 0.08),
    [driftAlerts]
  );

  const accuracyChartData = useMemo(
    () =>
      (snapshot?.accuracyOverTime ?? []).map((p) => ({
        date: p.date,
        accuracyRate: p.accuracyRate * 100,
      })),
    [snapshot]
  );

  const equityChartData = useMemo(
    () =>
      (snapshot?.equityCurve ?? []).map((p, i) => ({
        idx: i,
        cumulativeReturnPct: p.cumulativeReturnPct,
      })),
    [snapshot]
  );

  const lastRun = retrainStatus?.lastRun;

  return (
    <div className="space-y-6">
      <div className="card-premium rounded-3xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold flex items-center gap-2">
              <Activity className="h-5 w-5 text-cyan-400" />
              Live Performance
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Rolling accuracy · drift · auto-retrain · alerts
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-xl"
              disabled={loading}
              onClick={() => load(true)}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Обновить
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-xl"
              disabled={retrainLoading}
              onClick={() => runRetrain(false)}
            >
              {retrainLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Auto Retrain
            </Button>
            <Button
              type="button"
              size="sm"
              className="rounded-xl"
              disabled={retrainLoading}
              onClick={() => runRetrain(true)}
            >
              Force Retrain
            </Button>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {retrainMessage && <p className="mt-3 text-sm text-emerald-400">{retrainMessage}</p>}

        {retrainStatus && (
          <div className="mt-4 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5 text-xs">
            <p className="font-medium text-foreground">ML Retrain Status</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-muted-foreground">
              <span>
                Interval: <strong className="text-foreground">{retrainStatus.intervalDays}d</strong>
              </span>
              <span>
                Next:{" "}
                <strong className="text-foreground">
                  {retrainStatus.nextScheduledAt
                    ? new Date(retrainStatus.nextScheduledAt).toLocaleDateString("ru-RU")
                    : "—"}
                </strong>
              </span>
              <span>
                Due:{" "}
                <strong className={retrainStatus.decision.shouldRun ? "text-amber-300" : "text-foreground"}>
                  {retrainStatus.decision.shouldRun ? "Yes" : "No"}
                </strong>
              </span>
              <span className="truncate" title={retrainStatus.decision.reason}>
                {retrainStatus.decision.reason}
              </span>
            </div>
            {lastRun && (
              <p className="mt-2 text-muted-foreground">
                Last: {new Date(lastRun.finishedAt).toLocaleString("ru-RU")} ·{" "}
                <span className={lastRun.ok ? "text-emerald-400" : "text-red-400"}>
                  {lastRun.ok ? "OK" : "Failed"}
                </span>
                {" · "}
                {lastRun.samples} samples ({lastRun.trigger})
                {lastRun.weightsPath && ` → ${lastRun.weightsPath}`}
              </p>
            )}
          </div>
        )}

        {(alerts.length > 0 || alertHistory.length > 0) && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Bell className="h-4 w-4 text-amber-400" />
              Alerts
            </p>
            <ul className="mt-2 space-y-2">
              {alerts.map((a) => (
                <AlertRow key={a.id} alert={a} />
              ))}
              {alerts.length === 0 &&
                alertHistory.slice(0, 3).map((a) => (
                  <AlertRow key={a.id} alert={a} muted />
                ))}
            </ul>
          </div>
        )}

        {criticalDrift.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              Concept drift detected (accuracy drop &gt; 8%)
            </p>
            <ul className="mt-2 space-y-1 text-xs text-amber-200/80">
              {criticalDrift.map((a) => (
                <li key={`${a.dimension}-${a.key}`}>
                  {a.label}: {(a.baselineAccuracy * 100).toFixed(0)}% →{" "}
                  {(a.recentAccuracy * 100).toFixed(0)}% (−{(a.dropPct * 100).toFixed(0)}%)
                </li>
              ))}
            </ul>
          </div>
        )}

        {loading && !snapshot && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка метрик…
          </div>
        )}

        {snapshot && (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {snapshot.windows.map((w) => (
                <div key={w.windowDays} className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/5">
                  <p className="text-xs text-muted-foreground">{w.windowDays} дн. · направление угадано</p>
                  <p className="mt-1 font-display text-xl font-semibold">
                    {w.directionalCount ? `${(w.directionHitRate * 100).toFixed(1)}%` : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {w.directionalCount} сигналов · TP первым {(w.tpFirstRate * 100).toFixed(0)}% · сделка{" "}
                    {w.avgTradeReturnPct >= 0 ? "+" : ""}
                    {w.avgTradeReturnPct.toFixed(2)}% после комиссий
                  </p>
                </div>
              ))}
              <div className="rounded-xl bg-indigo-500/10 p-3 ring-1 ring-indigo-500/20">
                <p className="flex items-center gap-1 text-xs text-indigo-200">
                  <Shield className="h-3.5 w-3.5" />
                  Реальная точность (30 дн.)
                </p>
                <p className="mt-1 font-display text-xl font-semibold text-indigo-100">
                  {snapshot.modelConfidence.sampleCount ? `${snapshot.modelConfidence.score}%` : "—"}
                </p>
                <p className="text-[10px] text-indigo-200/70">
                  {snapshot.modelConfidence.sampleCount} сигналов
                  {snapshot.modelConfidence.sampleCount < 30 ? " · мало данных для выводов" : ""}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Accuracy over time (%)</p>
                <MiniChart data={accuracyChartData} color="#38bdf8" valueKey="accuracyRate" />
              </div>
              <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Live equity curve (%)</p>
                <MiniChart data={equityChartData} color="#34d399" valueKey="cumulativeReturnPct" />
              </div>
            </div>

            {snapshot.calibration && (
              <div className="mt-4 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Калибровка: сбываются ли заявленные проценты (180 дн.)
                </p>
                <div className="grid grid-cols-4 gap-2 text-xs tabular-nums">
                  {snapshot.calibration.map((b) => (
                    <div key={b.label} className="rounded-lg bg-white/[0.04] p-2">
                      <p className="text-[10px] text-muted-foreground">Заявлено {b.label}</p>
                      <p className="font-semibold">{b.count ? `${b.actual.toFixed(0)}%` : "—"}</p>
                      <p className="text-[10px] text-muted-foreground">{b.count} сигналов</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {snapshot.byRegime.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-sm font-medium">By Regime (180d)</p>
                <div className="overflow-x-auto rounded-xl ring-1 ring-white/5">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/5 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Regime</th>
                        <th className="px-3 py-2">N</th>
                        <th className="px-3 py-2">Accuracy</th>
                        <th className="px-3 py-2">Avg Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.byRegime.map((r) => (
                        <tr key={r.key} className="border-t border-white/5">
                          <td className="px-3 py-2">{r.label}</td>
                          <td className="px-3 py-2">{r.completed}</td>
                          <td className="px-3 py-2">{(r.accuracyRate * 100).toFixed(1)}%</td>
                          <td className="px-3 py-2">{r.avgScore.toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {(snapshot.bySymbol.length > 0 || snapshot.byTimeframe.length > 0) && (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {snapshot.bySymbol.length > 0 && (
                  <SegmentList title="By Symbol" items={snapshot.bySymbol} />
                )}
                {snapshot.byTimeframe.length > 0 && (
                  <SegmentList title="By Timeframe" items={snapshot.byTimeframe} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AlertRow({ alert, muted }: { alert: MonitoringAlert; muted?: boolean }) {
  const color =
    alert.severity === "critical"
      ? "text-red-300"
      : muted
        ? "text-muted-foreground"
        : "text-amber-200";

  return (
    <li className={cn("rounded-lg bg-white/[0.03] px-3 py-2 text-xs", muted && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("font-medium", color)}>{alertKindLabel(alert.kind)}</span>
        <span className="text-muted-foreground">·</span>
        <span>{alert.title}</span>
        {alert.dispatched && (
          <span className="text-[10px] text-emerald-400">sent ({alert.channels.join(", ")})</span>
        )}
      </div>
      <p className="mt-1 text-muted-foreground">{alert.message}</p>
    </li>
  );
}

function SegmentList({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; completed: number; accuracyRate: number }>;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{title}</p>
      <ul className="space-y-1 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5 text-xs">
        {items.slice(0, 8).map((item) => (
          <li key={item.label} className="flex justify-between gap-2">
            <span>{item.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {(item.accuracyRate * 100).toFixed(0)}% · n={item.completed}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
