"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { StrategyReport } from "@/services/strategy-lab/lab";
import { cn } from "@/lib/utils";

interface Row {
  timeframe: string;
  trained: boolean;
  interval?: string;
  trainedAt?: string;
  symbols: string[];
  strategy: StrategyReport | null;
}

const bp = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)} п.`;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export function StrategyLabPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/strategy-lab")
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 403 ? "Доступно только администратору" : "Не удалось загрузить");
        setRows(((await res.json()) as { timeframes: Row[] }).timeframes);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!rows) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Для каждого таймфрейма модель торгует своими сигналами на истории, которую не видела при обучении: стоп и цель в
        ATR, закрытие по сроку, одна позиция на монету, комиссии Binance (лимитные 0,04%, рыночные 0,1% за круг). Лучшая
        настройка выбирается на первых 60% периода и проверяется на последних 40%. Сайт предлагает сделку только там, где
        проверка прошла. 1 п. = 0,01% от суммы позиции.
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <StrategyRow key={r.timeframe} row={r} />
        ))}
      </div>
    </div>
  );
}

function StrategyRow({ row }: { row: Row }) {
  const s = row.strategy;
  const status = !row.trained ? "модель не обучена" : !s ? "не проверялась — переобучите модели" : s.reason;
  return (
    <div className="rounded-xl bg-white/5 p-3 text-sm ring-1 ring-white/8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {row.timeframe}
          {row.interval && <span className="ml-2 text-xs text-muted-foreground">бары {row.interval}</span>}
        </p>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-xs",
            s?.profitable ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
          )}
        >
          {s?.profitable ? "сделки предлагаются" : "сделок нет"}
        </span>
      </div>
      <p className="mt-1 text-muted-foreground">{status}</p>
      {s?.best && (
        <div className="mt-2 grid gap-1 text-xs tabular-nums sm:grid-cols-2">
          <p className="sm:col-span-2 text-muted-foreground">
            Лучшая из {s.setupsTested}: стоп {s.best.setup.slAtr} ATR, цель ×{s.best.setup.rr}, до {s.best.setup.horizon}{" "}
            баров, сигнал от {(s.best.setup.minEdge * 100).toFixed(0)} п.п.
          </p>
          <PeriodStats title="Подбор" period={s.selectionPeriod} m={s.best.selection} />
          <PeriodStats title="Проверка" period={s.holdoutPeriod} m={s.best.holdout} />
        </div>
      )}
    </div>
  );
}

function PeriodStats({
  title,
  period,
  m,
}: {
  title: string;
  period: { from: string; to: string };
  m: NonNullable<StrategyReport["best"]>["holdout"];
}) {
  return (
    <div className="rounded-lg bg-white/[0.03] p-2">
      <p className="text-muted-foreground">
        {title} · {period.from.slice(0, 10)} → {period.to.slice(0, 10)}
      </p>
      <p>
        {m.trades} сделок ({m.tradesPerWeek.toFixed(1)}/нед.) · в плюс {pct(m.winRate)}
      </p>
      <p>
        лимитными <span className={m.avgNetBp > 0 ? "text-emerald-400" : "text-red-400"}>{bp(m.avgNetBp)}</span> · рыночными{" "}
        <span className={m.avgNetBpTaker > 0 ? "text-emerald-400" : "text-red-400"}>{bp(m.avgNetBpTaker)}</span> на сделку
      </p>
      <p>
        итого {m.totalPct.toFixed(1)}% · просадка {m.maxDrawdownPct.toFixed(1)}% · t = {m.tStat.toFixed(1)}
      </p>
    </div>
  );
}
