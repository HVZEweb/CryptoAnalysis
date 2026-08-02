"use client";

import { BarChart3, Brain, Cpu } from "lucide-react";

export type TradingTab = "hft" | "quant" | "predictor";

interface TradingTabsProps {
  active: TradingTab;
  onChange: (tab: TradingTab) => void;
}

export function TradingTabs({ active, onChange }: TradingTabsProps) {
  return (
    <div className="mb-6 flex gap-2 rounded-2xl border border-white/10 bg-black/40 p-1">
      <button
        type="button"
        onClick={() => onChange("hft")}
        className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
          active === "hft"
            ? "bg-gradient-to-r from-violet-500/20 to-purple-500/20 text-violet-300 ring-1 ring-violet-500/30"
            : "text-muted-foreground hover:bg-white/5"
        }`}
      >
        <Cpu className="h-4 w-4" />
        HFT
      </button>
      <button
        type="button"
        onClick={() => onChange("predictor")}
        className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
          active === "predictor"
            ? "bg-gradient-to-r from-emerald-500/20 to-teal-500/20 text-emerald-300 ring-1 ring-emerald-500/30"
            : "text-muted-foreground hover:bg-white/5"
        }`}
      >
        <Brain className="h-4 w-4" />
        AI
      </button>
      <button
        type="button"
        onClick={() => onChange("quant")}
        className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
          active === "quant"
            ? "bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 ring-1 ring-cyan-500/30"
            : "text-muted-foreground hover:bg-white/5"
        }`}
      >
        <BarChart3 className="h-4 w-4" />
        Quant
      </button>
    </div>
  );
}
