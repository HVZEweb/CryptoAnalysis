"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PortfolioSummary } from "@/lib/portfolio-sim";
import { resolvePriceForecast } from "@/lib/price-forecast";
import type { PredictionHistoryItem } from "@/types";
import { dedupeHistoryItems, formatPrice, TIMEFRAME_LABELS, cn } from "@/lib/utils";

interface PortfolioPanelProps {
  history: PredictionHistoryItem[];
}

const EXIT_LABELS: Record<string, string> = {
  tp: "TP",
  sl: "SL",
  time: "Закрытие",
  skipped: "—",
};

const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 25, 50, 75, 100, 125] as const;

const inputClassName =
  "h-10 w-full rounded-xl border border-white/8 bg-white/5 px-3 text-sm tabular-nums outline-none transition focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-400/20";

export function PortfolioPanel({ history }: PortfolioPanelProps) {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marginUsd, setMarginUsd] = useState("100");
  const [leverage, setLeverage] = useState("10");

  const parsedMargin = useMemo(() => {
    const value = Number(marginUsd.replace(",", "."));
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [marginUsd]);

  const parsedLeverage = useMemo(() => {
    const value = Number(leverage);
    return Number.isFinite(value) && value >= 1 ? value : null;
  }, [leverage]);

  const notionalPreview =
    parsedMargin && parsedLeverage ? parsedMargin * parsedLeverage : null;

  useEffect(() => {
    if (history.length === 0) {
      setSummary(null);
      setError(null);
    }
  }, [history.length]);

  const calculate = useCallback(async () => {
    setLoading(true);
    setError(null);
    const items = dedupeHistoryItems(history);
    if (items.length === 0) {
      setError("Нет прогнозов для расчёта");
      setSummary(null);
      setLoading(false);
      return;
    }

    if (!parsedMargin) {
      setError("Укажите сумму больше 0");
      setSummary(null);
      setLoading(false);
      return;
    }

    if (!parsedLeverage) {
      setError("Выберите плечо");
      setSummary(null);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((h) => ({
            symbol: h.symbol,
            market: h.market,
            direction: h.direction,
            priceAtPrediction: h.priceAtPrediction,
            timeframe: h.timeframe,
            createdAt: h.createdAt,
            priceRange: h.priceRange,
            priceForecast: h.priceForecast ?? resolvePriceForecast(h),
            tradeLevels: h.tradeLevels,
          })),
          marginUsd: parsedMargin,
          leverage: parsedLeverage,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Ошибка расчёта");
        return;
      }
      setSummary(data.summary);
    } catch {
      setError("Не удалось выполнить расчёт");
    } finally {
      setLoading(false);
    }
  }, [history, parsedLeverage, parsedMargin]);

  const pnlPositive = (summary?.totalPnlUsd ?? 0) >= 0;

  return (
    <div className="card-premium rounded-3xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold flex items-center gap-2">
            <Wallet className="h-5 w-5 text-indigo-400" />
            Итог по всем прогнозам
          </h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md">
            Виртуальная торговля по прогнозам из вкладки «История». Укажите маржу и плечо — P&L
            считается от размера позиции.
          </p>
        </div>
        <Button
          type="button"
          onClick={calculate}
          disabled={loading || history.length === 0}
          className="rounded-xl shrink-0"
        >
          <Calculator className="h-4 w-4" />
          {loading ? "Считаем…" : "Подсчитать итог"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="portfolio-margin" className="text-xs text-muted-foreground">
            Сумма на сделку (USD)
          </Label>
          <input
            id="portfolio-margin"
            type="number"
            min={1}
            step={1}
            inputMode="decimal"
            value={marginUsd}
            onChange={(e) => setMarginUsd(e.target.value)}
            className={inputClassName}
            placeholder="100"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="portfolio-leverage" className="text-xs text-muted-foreground">
            Плечо
          </Label>
          <Select value={leverage} onValueChange={setLeverage}>
            <SelectTrigger id="portfolio-leverage" className="rounded-xl border-white/8 bg-white/5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEVERAGE_OPTIONS.map((x) => (
                <SelectItem key={x} value={String(x)}>
                  {x}x
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {notionalPreview !== null && (
        <p className="text-xs text-muted-foreground">
          Размер позиции:{" "}
          <span className="font-medium text-foreground tabular-nums">
            ${notionalPreview.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </span>{" "}
          · комиссия ~0.08%
        </p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!summary && !loading && !error && (
        <p className="text-sm text-muted-foreground text-center py-6">
          Нажмите «Подсчитать итог» — учитываются только прогнозы из текущей истории
        </p>
      )}

      {summary && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="P&L (завершённые)"
              value={`${pnlPositive ? "+" : ""}$${summary.totalPnlUsd.toFixed(2)}`}
              sub={`${summary.totalPnlPct >= 0 ? "+" : ""}${summary.totalPnlPct.toFixed(2)}% · ${summary.completedTrades} сделок${summary.interimPnlUsd !== 0 ? ` · в процессе ${summary.interimPnlUsd >= 0 ? "+" : ""}$${summary.interimPnlUsd.toFixed(0)}` : ""}`}
              positive={pnlPositive}
            />
            <StatCard
              label={`Баланс $${summary.virtualBalanceStart.toFixed(0)} →`}
              value={`$${summary.virtualBalanceEnd.toFixed(0)}`}
              sub={`${summary.compoundedReturnPct >= 0 ? "+" : ""}${summary.compoundedReturnPct.toFixed(2)}% реинвест · ${summary.leverage}x`}
              positive={summary.compoundedReturnPct >= 0}
            />
            <StatCard
              label="Win-rate"
              value={`${summary.winRate}%`}
              sub={`${summary.wins}W / ${summary.losses}L / ${summary.breakeven}BE`}
              positive={summary.winRate >= 50}
            />
            <StatCard
              label="Параметры"
              value={`$${summary.marginUsd} × ${summary.leverage}x`}
              sub={`Позиция $${summary.notionalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} · ${summary.evaluatedTrades} сделок`}
            />
          </div>

          <div className="max-h-64 overflow-y-auto rounded-xl bg-white/3 divide-y divide-white/5">
            {summary.trades.map((t, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 text-xs">
                {t.pnlPct >= 0 ? (
                  <TrendingUp className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <TrendingDown className="h-4 w-4 shrink-0 text-red-400" />
                )}
                <div className="min-w-0 flex-1">
                  <span className="font-medium">
                    {t.symbol} · {TIMEFRAME_LABELS[t.timeframe] ?? t.timeframe} · {t.direction}
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    ${formatPrice(t.entry)} → ${formatPrice(t.exitPrice)}
                  </span>
                </div>
                <span className="text-muted-foreground">{EXIT_LABELS[t.exitReason]}</span>
                <span
                  className={cn(
                    "w-16 text-right font-medium tabular-nums",
                    t.pnlPct >= 0 ? "text-emerald-400" : "text-red-400"
                  )}
                >
                  {t.pnlPct >= 0 ? "+" : ""}
                  {t.pnlPct.toFixed(2)}%
                </span>
                <span
                  className={cn(
                    "w-20 text-right font-medium tabular-nums",
                    t.pnlUsd >= 0 ? "text-emerald-400" : "text-red-400"
                  )}
                >
                  {t.pnlUsd >= 0 ? "+" : ""}${t.pnlUsd.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/3 p-3 ring-1 ring-white/5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-display text-lg font-bold tabular-nums",
          positive === true && "text-emerald-400",
          positive === false && "text-red-400"
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}
