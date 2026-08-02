"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart2, Clock, Percent, TrendingDown, TrendingUp } from "lucide-react";
import type { StrategyAnalytics, TradingAnalytics } from "@/lib/trading-bot-client";
import type { TradingTab } from "@/components/spread/trading-tabs";

const TAB_STRATEGY: Record<TradingTab, string> = {
  hft: "hft_orderbook",
  quant: "quant_scalping",
  predictor: "ai_predictor",
};

interface AnalyticsPanelProps {
  tab: TradingTab;
}

export function AnalyticsPanel({ tab }: AnalyticsPanelProps) {
  const [analytics, setAnalytics] = useState<TradingAnalytics | null>(null);

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch(`/api/trading/analytics?tab=${tab}`);
      const data = await res.json();
      if (data.success) setAnalytics(data.data);
    } catch {
      // ignore
    }
  }, [tab]);

  useEffect(() => {
    fetchAnalytics();
    const id = setInterval(fetchAnalytics, 5000);
    return () => clearInterval(id);
  }, [fetchAnalytics]);

  const strategyKey = TAB_STRATEGY[tab];
  const metrics: StrategyAnalytics | undefined =
    analytics?.by_strategy?.[strategyKey] ?? analytics?.overall;

  if (!metrics || metrics.trades === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
        <h3 className="mb-2 flex items-center gap-2 font-medium">
          <BarChart2 className="h-4 w-4 text-cyan-400" />
          Аналитика
        </h3>
        <p className="text-sm text-muted-foreground">
          Метрики появятся после закрытых сделок. Источник: {analytics?.source ?? "—"}
        </p>
      </div>
    );
  }

  const items = [
    { label: "Win Rate", value: `${metrics.win_rate.toFixed(1)}%`, icon: Percent },
    { label: "Profit Factor", value: metrics.profit_factor.toFixed(2), icon: TrendingUp },
    { label: "Expectancy", value: `$${metrics.expectancy_usd.toFixed(3)}`, icon: BarChart2 },
    { label: "Sharpe", value: metrics.sharpe_ratio.toFixed(2), icon: TrendingUp },
    { label: "Sortino", value: metrics.sortino_ratio.toFixed(2), icon: TrendingUp },
    { label: "Calmar", value: metrics.calmar_ratio.toFixed(2), icon: TrendingUp },
    { label: "Max DD", value: `${metrics.max_drawdown_pct.toFixed(1)}%`, icon: TrendingDown },
    { label: "Recovery", value: metrics.recovery_factor.toFixed(2), icon: TrendingUp },
    { label: "Avg Win", value: `$${metrics.avg_win_usd.toFixed(2)}`, icon: TrendingUp },
    { label: "Avg Loss", value: `$${metrics.avg_loss_usd.toFixed(2)}`, icon: TrendingDown },
    { label: "Avg Hold", value: `${metrics.avg_hold_min.toFixed(1)} мин`, icon: Clock },
    { label: "Total PnL", value: `$${metrics.total_pnl_usd.toFixed(2)}`, icon: BarChart2 },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-medium">
          <BarChart2 className="h-4 w-4 text-cyan-400" />
          Аналитика · {metrics.trades} сделок
        </h3>
        <span className="text-xs text-muted-foreground">
          {analytics?.source === "live" ? "Live API" : "Database"} · {analytics?.computed_at?.slice(11, 19)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-xl bg-white/5 px-3 py-2">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Icon className="h-3 w-3" />
                {item.label}
              </div>
              <p className="mt-1 font-medium">{item.value}</p>
            </div>
          );
        })}
      </div>

      {(analytics?.equity_curve?.length ?? 0) > 1 && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-muted-foreground">Equity curve (норм.)</p>
          <div className="flex h-12 items-end gap-0.5">
            {analytics!.equity_curve.map((v, i) => {
              const min = Math.min(...analytics!.equity_curve);
              const max = Math.max(...analytics!.equity_curve);
              const h = max > min ? ((v - min) / (max - min)) * 100 : 50;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-cyan-500/60"
                  style={{ height: `${Math.max(8, h)}%` }}
                  title={v.toFixed(4)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
