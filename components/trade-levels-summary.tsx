"use client";

import { Target } from "lucide-react";
import { formatLevelDelta, resolveTradeLevels, type TradeLevels } from "@/lib/trade-levels";
import { cn, formatPrice } from "@/lib/utils";
import type { PredictionResult } from "@/types";

interface TradeLevelsSummaryProps {
  prediction: PredictionResult;
  className?: string;
}

export function TradeLevelsSummary({ prediction, className }: TradeLevelsSummaryProps) {
  const levels = resolveTradeLevels(prediction);
  const tpPositive =
    prediction.direction === "LONG"
      ? levels.tp >= levels.entry
      : prediction.direction === "SHORT"
        ? levels.tp <= levels.entry
        : true;

  return (
    <div className={cn("rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/8", className)}>
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-indigo-300">
        <Target className="h-3 w-3" />
        Быстрая сводка
      </p>
      <TradeLevelsGrid levels={levels} tpPositive={tpPositive} />
    </div>
  );
}

export function TradeLevelsGrid({
  levels,
  tpPositive,
}: {
  levels: TradeLevels;
  tpPositive: boolean;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <LevelRow label="Вход" price={levels.entry} delta="" accent="text-foreground" />
        <LevelRow
          label="TP"
          price={levels.tp}
          delta={formatLevelDelta(levels.entry, levels.tp)}
          accent={tpPositive ? "text-emerald-400" : "text-red-400"}
        />
        <LevelRow
          label="SL"
          price={levels.sl}
          delta={formatLevelDelta(levels.entry, levels.sl)}
          accent="text-red-400"
        />
        <LevelRow
          label="Выход"
          price={levels.exit}
          delta={formatLevelDelta(levels.entry, levels.exit)}
          accent="text-amber-300"
        />
      </div>
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">{levels.hint}</p>
    </>
  );
}

function LevelRow({
  label,
  price,
  delta,
  accent,
}: {
  label: string;
  price: number;
  delta: string;
  accent: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("font-medium tabular-nums", accent)}>${formatPrice(price)}</p>
      {delta && <p className={cn("text-[10px] tabular-nums", accent)}>{delta}</p>}
    </div>
  );
}
