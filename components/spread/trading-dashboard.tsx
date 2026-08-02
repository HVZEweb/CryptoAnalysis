"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Brain,
  BarChart3,
  Cpu,
  Play,
  Square,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { TradingBotStatus, TradingPosition, TradingTrade } from "@/lib/trading-bot-client";
import type { TradingTab } from "@/components/spread/trading-tabs";
import { AnalyticsPanel } from "@/components/spread/analytics-panel";

const TAB_META: Record<TradingTab, { title: string; icon: typeof Cpu; gradient: string }> = {
  hft: { title: "HFT Orderbook", icon: Cpu, gradient: "from-violet-500 to-purple-600" },
  quant: { title: "Quant Scalping", icon: BarChart3, gradient: "from-cyan-500 to-blue-600" },
  predictor: { title: "AI Predictor", icon: Brain, gradient: "from-emerald-500 to-teal-600" },
};

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec} сек`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

interface TradingDashboardProps {
  tab: TradingTab;
}

export function TradingDashboard({ tab }: TradingDashboardProps) {
  const meta = TAB_META[tab];
  const Icon = meta.icon;

  const [online, setOnline] = useState(false);
  const [processRunning, setProcessRunning] = useState(false);
  const [status, setStatus] = useState<TradingBotStatus | null>(null);
  const [trades, setTrades] = useState<TradingTrade[]>([]);
  const [positions, setPositions] = useState<TradingPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [logTail, setLogTail] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/trading");
      const data = await res.json();
      if (!data.success) return;
      setOnline(data.data.online);
      setProcessRunning(data.data.process_running);
      setStatus(data.data.status);
      setTrades(data.data.trades ?? []);
      setPositions(data.data.positions ?? []);
      setLogTail(data.data.log_tail ?? "");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 2000);
    return () => clearInterval(id);
  }, [fetchData]);

  useEffect(() => {
    if (!online) return;
    fetch("/api/trading", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mode", tab }),
    }).catch(() => {});
  }, [tab, online]);

  const apiCall = async (action: string, extra?: Record<string, unknown>) => {
    setLoading(true);
    try {
      const res = await fetch("/api/trading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, tab, ...extra }),
      });
      const data = await res.json();
      if (!data.success) alert(data.error ?? data.message ?? "Ошибка");
      await fetchData();
    } finally {
      setLoading(false);
    }
  };

  const isRunning = status?.running ?? false;
  const filteredTrades = trades.filter((t) => {
    if (tab === "hft") return t.strategy === "hft_orderbook";
    if (tab === "quant") return t.strategy === "quant_scalping";
    return t.strategy === "ai_predictor";
  });

  return (
    <div className="space-y-6">
      <div
        className={`rounded-2xl border p-4 ${
          isRunning ? "border-violet-500/30 bg-violet-500/10" : "border-white/10 bg-black/40"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${meta.gradient}`}>
              <Icon className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-medium">{meta.title}</p>
              <p className="text-xs text-muted-foreground">
                {status?.mode === "live" ? "LIVE ⚠️" : "PAPER"} · OKX Futures · единый runtime
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {!isRunning ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => apiCall("start")}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                Запустить
              </button>
            ) : (
              <button
                type="button"
                disabled={loading}
                onClick={() => apiCall("stop")}
                className="flex items-center gap-2 rounded-xl bg-red-600/80 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                <Square className="h-4 w-4" />
                Остановить
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <Stat label="Процесс" value={processRunning ? "✓ PID" : "—"} />
          <Stat label="API" value={online ? "Online" : "Offline"} />
          <Stat label="Uptime" value={formatUptime(status?.uptime_sec ?? 0)} />
          <Stat label="Equity" value={`$${(status?.equity ?? 0).toFixed(2)}`} />
          <Stat label="PnL" value={`$${(status?.stats?.net_pnl_usd ?? 0).toFixed(2)}`} />
          <Stat label="Позиции" value={String(status?.open_positions ?? 0)} />
        </div>

        {status?.emergency_stop && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <AlertTriangle className="h-4 w-4" />
            Emergency stop активен
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
          <h3 className="mb-3 flex items-center gap-2 font-medium">
            <Activity className="h-4 w-4 text-violet-400" />
            Universe (топ пары)
          </h3>
          <div className="space-y-2">
            {(status?.universe ?? []).slice(0, 8).map((u) => (
              <div key={u.symbol} className="flex justify-between rounded-lg bg-white/5 px-3 py-2 text-sm">
                <span>{u.symbol}</span>
                <span className="text-muted-foreground">
                  score {u.score.toFixed(0)} · {u.reason}
                </span>
              </div>
            ))}
            {!status?.universe?.length && (
              <p className="text-sm text-muted-foreground">Запустите бота для сканирования</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
          <h3 className="mb-3 flex items-center gap-2 font-medium">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            Открытые позиции
          </h3>
          <div className="space-y-2">
            {positions.map((p) => (
              <div key={p.trade_id} className="rounded-lg bg-white/5 px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span>
                    {p.symbol} {p.side.toUpperCase()}
                  </span>
                  <span className="text-muted-foreground">{p.strategy}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  entry ${p.entry_price.toFixed(4)} · SL ${p.stop_loss.toFixed(4)} · TP ${p.take_profit.toFixed(4)}
                </div>
              </div>
            ))}
            {!positions.length && <p className="text-sm text-muted-foreground">Нет открытых позиций</p>}
          </div>
        </div>
      </div>

      <AnalyticsPanel tab={tab} />

      <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
        <h3 className="mb-3 flex items-center gap-2 font-medium">
          <Bot className="h-4 w-4" />
          Сделки ({meta.title})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-muted-foreground">
                <th className="pb-2 pr-4">Symbol</th>
                <th className="pb-2 pr-4">Side</th>
                <th className="pb-2 pr-4">EV</th>
                <th className="pb-2 pr-4">Conf</th>
                <th className="pb-2 pr-4">Hold</th>
                <th className="pb-2 pr-4">PnL</th>
                <th className="pb-2">Exit</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.slice(0, 15).map((t) => (
                <tr key={t.trade_uuid} className="border-b border-white/5">
                  <td className="py-2 pr-4">{t.symbol}</td>
                  <td className="py-2 pr-4">{t.side}</td>
                  <td className="py-2 pr-4">{t.expected_value?.toFixed(3)}</td>
                  <td className="py-2 pr-4">{t.confidence?.toFixed(0)}%</td>
                  <td className="py-2 pr-4">
                    {t.hold_min != null ? `${t.hold_min}м` : t.status === "open" ? "—" : `${Math.round((t.hold_ms ?? 0) / 60000)}м`}
                  </td>
                  <td className={`py-2 pr-4 ${(t.pnl_usd ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    ${(t.pnl_usd ?? 0).toFixed(2)}
                  </td>
                  <td className="py-2 max-w-[120px] truncate text-xs text-muted-foreground" title={t.exit_reason}>
                    {t.exit_reason || t.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredTrades.length && (
            <p className="py-4 text-sm text-muted-foreground">Сделок пока нет</p>
          )}
        </div>
      </div>

      {logTail && (
        <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Zap className="h-4 w-4" />
            Лог
          </h3>
          <pre className="max-h-40 overflow-auto text-xs text-muted-foreground">{logTail}</pre>
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Нет гарантии прибыли. Эффективность подтверждается paper trading и бэктестами.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
