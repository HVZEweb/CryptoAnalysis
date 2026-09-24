"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { CoinSelect } from "@/components/coin-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BacktestReport } from "@/lib/backtesting/types";
import type { BacktestRunSummary } from "@/lib/backtesting/runs-store";
import { cn } from "@/lib/utils";
import type { Coin } from "@/types";

const TIMEFRAMES = ["15m", "30m", "1h", "4h", "12h", "24h", "3d", "7d"] as const;

interface BacktestFormState {
  coinSymbol: string;
  market: "Spot" | "Futures";
  timeframe: (typeof TIMEFRAMES)[number];
  periodDays: number;
  mode: "ensemble" | "full";
  exportTraining: boolean;
  retrainMl: boolean;
}

function buildEquitySeries(trades: BacktestReport["trades"]): { equity: number[]; drawdown: number[] } {
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  let cum = 0;
  let peak = 0;
  const equity: number[] = [0];
  const drawdown: number[] = [0];

  for (const t of sorted) {
    cum += t.returnPct;
    peak = Math.max(peak, cum);
    equity.push(cum);
    drawdown.push(peak > 0 ? ((peak - cum) / Math.max(peak, 0.01)) * 100 : 0);
  }

  return { equity, drawdown };
}

function MiniChart({
  data,
  color,
  height = 64,
}: {
  data: number[];
  color: string;
  height?: number;
}) {
  if (data.length < 2) {
    return (
      <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
        Недостаточно сделок
      </div>
    );
  }

  const w = 320;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = height - ((v - min) / range) * (height - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="h-16 w-full" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        points={points}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function BacktestPanel() {
  const [coin, setCoin] = useState<Coin | null>(null);
  const [form, setForm] = useState<BacktestFormState>({
    coinSymbol: "BTC",
    market: "Futures",
    timeframe: "4h",
    periodDays: 90,
    mode: "ensemble",
    exportTraining: true,
    retrainMl: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<BacktestReport | null>(null);
  const [runs, setRuns] = useState<BacktestRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [retrainLoading, setRetrainLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [retrainPrompt, setRetrainPrompt] = useState(false);
  const [retrainResult, setRetrainResult] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const res = await fetch("/api/backtest");
      if (res.ok) {
        const data = (await res.json()) as { runs: BacktestRunSummary[] };
        setRuns(data.runs ?? []);
      }
    } catch {
      // ignore
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const chartData = useMemo(
    () => (report ? buildEquitySeries(report.trades) : { equity: [], drawdown: [] }),
    [report]
  );

  const runBacktest = async () => {
    if (!form.coinSymbol) {
      setError("Выберите монету");
      return;
    }

    setLoading(true);
    setError(null);
    setRetrainPrompt(false);
    setRetrainResult(null);

    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coinSymbol: form.coinSymbol,
          market: form.market,
          timeframe: form.timeframe,
          periodDays: form.periodDays,
          mode: form.mode,
          maxTrades: 80,
          exportTraining: form.exportTraining,
          retrainMl: form.retrainMl,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message ?? "Backtest failed");
      }

      const newReport = data.report as BacktestReport;
      setReport(newReport);
      await loadRuns();

      if (
        form.exportTraining &&
        !form.retrainMl &&
        newReport.trainingExport &&
        newReport.trainingExport.labeledCount >= 20
      ) {
        setRetrainPrompt(true);
      }

      if (newReport.mlRetrain?.ok) {
        setRetrainResult(
          `ML retrain: ${newReport.mlRetrain.samples} samples → ${newReport.mlRetrain.weightsPath}`
        );
      } else if (newReport.mlRetrain && !newReport.mlRetrain.ok) {
        setRetrainResult(`ML retrain failed: ${newReport.mlRetrain.error}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка backtest");
    } finally {
      setLoading(false);
    }
  };

  const exportTraining = async () => {
    setExportLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest/training", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Export failed");
      }
      window.open("/api/backtest/training", "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportLoading(false);
    }
  };

  const runRetrain = async () => {
    setRetrainLoading(true);
    setError(null);
    setRetrainPrompt(false);
    try {
      const res = await fetch("/api/backtest/retrain", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message ?? data.result?.error ?? "Retrain failed");
      }
      setRetrainResult(
        `ML retrain OK: ${data.result.samples} samples → ${data.result.weightsPath}`
      );
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retrain failed");
    } finally {
      setRetrainLoading(false);
    }
  };

  const loadRun = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/backtest?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Load failed");
      setReport(data.report as BacktestReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card-premium gradient-border rounded-3xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-indigo-400" />
              Walk-Forward Backtest
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Ensemble (proxy LLM) на истории Binance · экспорт JSONL
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Монета</Label>
            <CoinSelect
              value={coin}
              onChange={(c) => {
                setCoin(c);
                setForm((f) => ({ ...f, coinSymbol: c.symbol }));
              }}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Рынок</Label>
            <Select
              value={form.market}
              onValueChange={(v) => setForm((f) => ({ ...f, market: v as "Spot" | "Futures" }))}
            >
              <SelectTrigger className="rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Futures">Futures</SelectItem>
                <SelectItem value="Spot">Spot</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Таймфрейм</Label>
            <Select
              value={form.timeframe}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, timeframe: v as BacktestFormState["timeframe"] }))
              }
            >
              <SelectTrigger className="rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf} value={tf}>
                    {tf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Период (дней)</Label>
            <Select
              value={String(form.periodDays)}
              onValueChange={(v) => setForm((f) => ({ ...f, periodDays: Number(v) }))}
            >
              <SelectTrigger className="rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[30, 60, 90, 180, 365].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} дней
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Режим</Label>
            <Select
              value={form.mode}
              onValueChange={(v) => setForm((f) => ({ ...f, mode: v as "ensemble" | "full" }))}
            >
              <SelectTrigger className="rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ensemble">Ensemble (proxy LLM)</SelectItem>
                <SelectItem value="full">Full (real LLM на последнем баре)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col justify-end gap-2 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.exportTraining}
                onChange={(e) => setForm((f) => ({ ...f, exportTraining: e.target.checked }))}
                className="rounded border-white/20"
              />
              Export Training JSONL
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.retrainMl}
                onChange={(e) => setForm((f) => ({ ...f, retrainMl: e.target.checked }))}
                className="rounded border-white/20"
              />
              Auto-retrain ML после backtest
            </label>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="rounded-xl"
            disabled={loading}
            onClick={runBacktest}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Запустить backtest
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="rounded-xl"
            disabled={exportLoading}
            onClick={exportTraining}
          >
            {exportLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export Training JSONL
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="rounded-xl"
            disabled={retrainLoading}
            onClick={runRetrain}
          >
            {retrainLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Retrain ML
          </Button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {retrainResult && <p className="text-sm text-emerald-400">{retrainResult}</p>}

        {retrainPrompt && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <p className="font-medium text-amber-200">
              Достаточно labeled samples — запустить ML retrain?
            </p>
            <p className="mt-1 text-xs text-amber-200/70">
              {report?.trainingExport?.labeledCount} samples в JSONL. Обновит `.cache/ml-weights.json`.
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-3 rounded-lg"
              disabled={retrainLoading}
              onClick={runRetrain}
            >
              {retrainLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Запустить retrain
            </Button>
          </div>
        )}
      </div>

      {report && (
        <div className="card-premium rounded-3xl p-5 space-y-4">
          <h3 className="font-display text-lg font-semibold">
            {report.symbol} · {report.timeframe} · {report.mode}
          </h3>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Win Rate"
              value={`${(report.metrics.winRate * 100).toFixed(1)}%`}
              icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
            />
            <MetricCard
              label="Sharpe"
              value={report.metrics.sharpeRatio.toFixed(2)}
              icon={<Activity className="h-4 w-4 text-cyan-400" />}
            />
            <MetricCard
              label="Profit Factor"
              value={report.metrics.profitFactor.toFixed(2)}
              icon={<BarChart3 className="h-4 w-4 text-indigo-400" />}
            />
            <MetricCard
              label="Max Drawdown"
              value={`${report.metrics.maxDrawdownPct.toFixed(2)}%`}
              icon={<TrendingDown className="h-4 w-4 text-red-400" />}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Equity Curve (% cum.)</p>
              <MiniChart data={chartData.equity} color="#34d399" />
            </div>
            <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Drawdown %</p>
              <MiniChart data={chartData.drawdown} color="#f87171" />
            </div>
          </div>

          {report.metrics.accuracyByRegime.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">By Regime</p>
              <div className="overflow-x-auto rounded-xl ring-1 ring-white/5">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/5 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Regime</th>
                      <th className="px-3 py-2">Trades</th>
                      <th className="px-3 py-2">Win Rate</th>
                      <th className="px-3 py-2">Avg Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.metrics.accuracyByRegime.map((r) => (
                      <tr key={r.regime} className="border-t border-white/5">
                        <td className="px-3 py-2">{r.regime}</td>
                        <td className="px-3 py-2">{r.trades}</td>
                        <td className="px-3 py-2">{(r.winRate * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2">{r.avgReturnPct.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {report.notes.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {report.notes.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="card-premium rounded-3xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Последние runs</h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-lg"
            disabled={runsLoading}
            onClick={loadRuns}
          >
            <RefreshCw className={cn("h-4 w-4", runsLoading && "animate-spin")} />
          </Button>
        </div>

        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Пока нет сохранённых backtest runs</p>
        ) : (
          <div className="overflow-x-auto rounded-xl ring-1 ring-white/5">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Дата</th>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">TF</th>
                  <th className="px-3 py-2">Trades</th>
                  <th className="px-3 py-2">WR</th>
                  <th className="px-3 py-2">Sharpe</th>
                  <th className="px-3 py-2">PF</th>
                  <th className="px-3 py-2">Train</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(r.generatedAt).toLocaleString("ru-RU", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-3 py-2">{r.symbol}</td>
                    <td className="px-3 py-2">{r.timeframe}</td>
                    <td className="px-3 py-2">{r.totalTrades}</td>
                    <td className="px-3 py-2">{(r.winRate * 100).toFixed(0)}%</td>
                    <td className="px-3 py-2">{r.sharpeRatio.toFixed(2)}</td>
                    <td className="px-3 py-2">{r.profitFactor.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      {r.trainingExported ? (
                        <span className="text-emerald-400">{r.trainingSamples ?? "✓"}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-indigo-400 hover:text-indigo-300"
                        onClick={() => loadRun(r.id)}
                      >
                        Открыть
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 font-display text-xl font-semibold">{value}</p>
    </div>
  );
}
