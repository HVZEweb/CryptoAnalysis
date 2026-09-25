"use client";

import { motion } from "framer-motion";
import { BarChart3, BellRing, History, LineChart, Rocket, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabId = "predict" | "analysis" | "history" | "accuracy" | "signals" | "listings";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "predict", label: "Прогноз", icon: Sparkles },
  { id: "analysis", label: "Анализ", icon: BarChart3 },
  { id: "history", label: "История", icon: History },
  { id: "accuracy", label: "Точность", icon: LineChart },
  { id: "signals", label: "Сигналы", icon: BellRing },
  { id: "listings", label: "Листинги", icon: Rocket },
];

interface TabNavProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  historyCount?: number;
}

export function TabNav({ active, onChange, historyCount = 0 }: TabNavProps) {
  return (
    <nav className="card-premium relative grid grid-cols-3 gap-1 sm:grid-cols-6 rounded-2xl p-1.5">
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-xs font-medium transition-colors z-10",
              isActive ? "text-indigo-200" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {isActive && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 rounded-xl bg-gradient-to-b from-indigo-500/25 to-violet-500/10 ring-1 ring-indigo-500/20"
                transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
              />
            )}
            <span className="relative flex h-4 w-4 items-center justify-center">
              <tab.icon className={cn("h-4 w-4", isActive && "text-indigo-300")} />
              {tab.id === "history" && historyCount > 0 && (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-500 px-1 text-[9px] font-semibold text-white ring-2 ring-[#0d0d14]">
                  {historyCount}
                </span>
              )}
            </span>
            <span className="relative">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
