"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, History, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIRECTION_CONFIG, TIMEFRAME_LABELS } from "@/lib/utils";
import type { PredictionHistoryItem } from "@/types";

interface PredictionHistoryProps {
  history: PredictionHistoryItem[];
  onView: (item: PredictionHistoryItem) => void;
  onRepeat: (item: PredictionHistoryItem) => void;
  onClear: () => void;
}

export function PredictionHistory({ history, onView, onRepeat, onClear }: PredictionHistoryProps) {
  return (
    <div className="card-premium rounded-3xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display flex items-center gap-2 text-lg font-semibold">
          <History className="h-5 w-5 text-indigo-400" />
          История
        </h3>
        <Button variant="ghost" size="sm" onClick={onClear} className="rounded-xl text-muted-foreground">
          <Trash2 className="h-4 w-4" /> Очистить
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Нажмите на запись, чтобы открыть полный прогноз</p>
      <div className="space-y-2">
        <AnimatePresence>
          {history.map((item, i) => {
            const dir = DIRECTION_CONFIG[item.direction];
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ delay: i * 0.04 }}
                role="button"
                tabIndex={0}
                onClick={() => onView(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onView(item);
                  }
                }}
                className="group flex cursor-pointer items-center justify-between rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/5 transition-colors hover:bg-white/[0.06] hover:ring-indigo-500/20"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="text-xl">{dir.emoji}</span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.symbol} — {item.coin}</p>
                    <p className="text-xs text-muted-foreground">
                      {TIMEFRAME_LABELS[item.timeframe]} · {item.probability}% · {dir.label}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRepeat(item);
                    }}
                    className="rounded-xl opacity-60 group-hover:opacity-100"
                    title="Повторить прогноз"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
