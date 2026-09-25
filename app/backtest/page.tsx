"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Activity, LineChart, Scale } from "lucide-react";
import { BacktestPanel } from "@/components/BacktestPanel";
import { LivePerformancePanel } from "@/components/LivePerformancePanel";
import { StrategyLabPanel } from "@/components/StrategyLabPanel";
import { cn } from "@/lib/utils";

type Tab = "backtest" | "live" | "strategy";

export default function BacktestPage() {
  const [tab, setTab] = useState<Tab>("backtest");

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-black to-zinc-950 text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 text-2xl font-bold"
            >
              <LineChart className="h-7 w-7 text-indigo-400" />
              Backtest & Live Performance
            </motion.h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Walk-forward backtest · training loop · production monitoring
            </p>
          </div>
          <Link
            href="/"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
          >
            ← Главная
          </Link>
        </div>

        <div className="mb-6 flex gap-2 rounded-xl border border-white/10 bg-white/5 p-1">
          <TabButton active={tab === "backtest"} onClick={() => setTab("backtest")} icon={LineChart}>
            Backtest
          </TabButton>
          <TabButton active={tab === "live"} onClick={() => setTab("live")} icon={Activity}>
            Live Performance
          </TabButton>
          <TabButton active={tab === "strategy"} onClick={() => setTab("strategy")} icon={Scale}>
            Сделки после комиссий
          </TabButton>
        </div>

        {tab === "backtest" ? <BacktestPanel /> : tab === "live" ? <LivePerformancePanel /> : <StrategyLabPanel />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-indigo-500/20 text-indigo-100 ring-1 ring-indigo-500/30"
          : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}
