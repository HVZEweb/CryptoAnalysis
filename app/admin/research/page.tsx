"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { XsMetrics, XsReport, XsSetup } from "@/services/cross-section/research";
import { cn } from "@/lib/utils";

interface State {
  report: XsReport | null;
  running: { startedAt: string } | null;
  lastError: string | null;
}

const bp = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)} п.`;
const setupLabel = (s: XsSetup) =>
  `${s.mode === "momentum" ? "Импульс" : "Разворот"}: рейтинг по ${s.lookback} д., пересбор каждые ${s.hold} д.`;

export default function ResearchPage() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/research/cross-section");
    if (!res.ok) {
      setError("Не удалось загрузить отчёт");
      return;
    }
    setState((await res.json()) as State);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!state?.running) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [state?.running, load]);

  const start = async () => {
    await fetch("/api/research/cross-section", { method: "POST" });
    await load();
  };

  const r = state?.report;
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Рейтинг монет</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Не угадываем, куда пойдёт одна монета, а сравниваем 50 монет между собой: покупаем лучшую пятую часть, продаём
            худшую, раз в несколько дней пересобираем. Комиссии за каждую пересборку учтены. Настройка подбирается на первой
            половине истории, проверяется на второй. 1 п. = 0,01% от суммы позиции за период.
          </p>
        </div>
        <Link href="/admin" className="shrink-0 text-sm text-indigo-300 hover:underline">
          ← Админка
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={start} disabled={Boolean(state?.running)}>
          {state?.running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {state?.running ? "Считается…" : r ? "Пересчитать" : "Запустить исследование"}
        </Button>
        {state?.running && <span className="text-sm text-muted-foreground">загрузка 3 лет истории занимает 1–2 минуты</span>}
      </div>
      {(error || state?.lastError) && <p className="text-sm text-red-400">{error || state?.lastError}</p>}

      {r && (
        <div className="space-y-4">
          <div className={cn("rounded-xl p-4 ring-1", r.profitable ? "bg-emerald-500/10 ring-emerald-500/30" : "bg-amber-500/10 ring-amber-500/30")}>
            <p className="font-medium">{r.profitable ? "Есть подтверждённое преимущество" : "Подтверждённого преимущества нет"}</p>
            <p className="mt-1 text-sm">{r.reason}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {r.symbols.length} монет · {r.dataFrom.slice(0, 10)} → {r.dataTo.slice(0, 10)} · подбор до {r.selectionPeriod.to.slice(0, 10)}, проверка
              после · настроек проверено: {r.setupsTested} · посчитано {new Date(r.evaluatedAt).toLocaleString("ru-RU")}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Лучшие настройки на первой половине и что с ними стало на второй:</p>
            {r.leaders.map((l, i) => (
              <div key={i} className="rounded-xl bg-white/5 p-3 text-sm ring-1 ring-white/8">
                <p className="font-medium">{setupLabel(l.setup)}</p>
                <div className="mt-2 grid gap-2 text-xs tabular-nums sm:grid-cols-2">
                  <Stats title="Подбор" m={l.selection} />
                  <Stats title="Проверка" m={l.holdout} />
                </div>
              </div>
            ))}
          </div>

          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {r.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {state && !r && !state.running && <p className="text-sm text-muted-foreground">Исследование ещё не запускалось.</p>}
    </main>
  );
}

function Stats({ title, m }: { title: string; m: XsMetrics }) {
  const good = m.avgNetBp > 0;
  return (
    <div className="rounded-lg bg-white/[0.03] p-2">
      <p className="text-muted-foreground">
        {title} · {m.periods} периодов
      </p>
      <p>
        за период <span className={good ? "text-emerald-400" : "text-red-400"}>{bp(m.avgNetBp)}</span> (рыночными {bp(m.avgNetBpTaker)}) · в
        плюс {(m.winRate * 100).toFixed(0)}%
      </p>
      <p>
        {m.annualPct.toFixed(1)}% годовых · Sharpe {m.sharpe.toFixed(2)} · t = {m.tStat.toFixed(1)} · просадка {m.maxDrawdownPct.toFixed(1)}%
      </p>
    </div>
  );
}
