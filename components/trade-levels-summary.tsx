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
      {prediction.strategy && <StrategyNote strategy={prediction.strategy} />}
      {prediction.tradeEconomics && prediction.strategy?.status !== "no_setup" && prediction.strategy?.status !== "weak_signal" && (
        <TradeEconomicsNote economics={prediction.tradeEconomics} />
      )}
    </div>
  );
}

function StrategyNote({ strategy }: { strategy: NonNullable<PredictionResult["strategy"]> }) {
  const h = strategy.holdout;
  if (strategy.status !== "trade") {
    return (
      <p className="mt-3 border-t border-white/8 pt-2 text-[11px] font-medium text-amber-300">
        Сделка не предлагается: {strategy.reason}
      </p>
    );
  }
  return (
    <p className="mt-3 border-t border-white/8 pt-2 text-[11px] text-emerald-400">
      Проверенная стратегия
      {h && ` · на новых данных ${h.avgNetBp >= 0 ? "+" : ""}${h.avgNetBp.toFixed(1)} п./сделку после комиссий, ${(h.winRate * 100).toFixed(0)}% в плюс, ${h.trades} сделок`}
    </p>
  );
}

function TradeEconomicsNote({ economics }: { economics: NonNullable<PredictionResult["tradeEconomics"]> }) {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const rows = [
    { label: "Всё рыночными", e: economics.market },
    { label: "Цель лимитным", e: economics.limit },
  ];
  return (
    <div className="mt-3 border-t border-white/8 pt-2 text-[11px]">
      <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        С комиссиями · шанс TP раньше SL ≈ {pct(economics.winProbability)}
      </p>
      {rows.map(({ label, e }) => (
        <div key={label} className="flex justify-between gap-2 tabular-nums">
          <span className="text-muted-foreground">{label}</span>
          <span>
            <span className="text-emerald-400">+{formatPrice(e.netProfit)}</span>
            {" / "}
            <span className="text-red-400">−{formatPrice(e.netLoss)}</span>
            {" · безубыток "}
            {pct(e.breakevenWinRate)}
          </span>
        </div>
      ))}
      <p className={cn("mt-1 font-medium", economics.worthTrading ? "text-emerald-400" : "text-amber-300")}>
        {economics.worthTrading
          ? economics.preferredOrder === "market"
            ? "Ожидаемый результат положительный"
            : "Имеет смысл, только если цель выставить лимитным ордером"
          : "После комиссий в среднем убыточно — лучше не входить"}
      </p>
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
