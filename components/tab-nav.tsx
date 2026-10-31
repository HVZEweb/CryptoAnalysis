"use client";

import { cn } from "@/lib/utils";

export type TabId = "predict" | "opportunities" | "analysis" | "history" | "accuracy" | "signals" | "listings";

export const TAB_IDS: TabId[] = ["predict", "opportunities", "analysis", "history", "accuracy", "signals", "listings"];

const TABS: { id: TabId; label: string }[] = [
  { id: "predict", label: "Прогноз" },
  { id: "opportunities", label: "Возможности" },
  { id: "signals", label: "Сигналы" },
  { id: "history", label: "История" },
  { id: "accuracy", label: "Точность" },
  { id: "analysis", label: "Анализ" },
  { id: "listings", label: "Листинги" },
];

interface TabNavProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  historyCount?: number;
  className?: string;
}

/** Text tabs with an underline for the current section; one scrollable row on narrow screens. */
export function TabNav({ active, onChange, historyCount = 0, className }: TabNavProps) {
  return (
    <nav className={cn("no-scrollbar -mb-px flex overflow-x-auto", className)} aria-label="Разделы">
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative shrink-0 whitespace-nowrap px-3 py-3 text-sm transition-colors",
              isActive ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.id === "history" && historyCount > 0 && (
              <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">{historyCount}</span>
            )}
            <span className={cn("absolute inset-x-3 bottom-0 h-0.5 rounded-full", isActive ? "bg-indigo-400" : "bg-transparent")} />
          </button>
        );
      })}
    </nav>
  );
}
