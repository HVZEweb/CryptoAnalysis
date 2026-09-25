"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Row {
  base: string;
  listTime: number;
  markets: string;
  live: boolean;
  announcementUrl: string | null;
  entry: number | null;
  change4: number | null;
  change24: number | null;
  change168: number | null;
  maxUp24: number | null;
  maxDown24: number | null;
  onBinance: boolean | null;
  marketCap: number | null;
}

interface Study {
  listings: number;
  moves: Array<{ hours: number; median: number; shareUp: number; n: number }>;
  best: { selection: { trades: number; avg: number; tStat: number }; holdout: { trades: number; avg: number; tStat: number; winRate: number } } | null;
  bestLabel: string | null;
  passed: boolean;
  reason: string;
}

const pct = (x: number | null, digits = 1) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`);
const tone = (x: number | null) => (x == null ? "" : x > 0 ? "text-emerald-400" : x < 0 ? "text-red-400" : "");
const date = (t: number) => new Date(t).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const HORIZON: Record<number, string> = { 4: "4 часа", 24: "сутки", 72: "3 дня", 168: "неделя" };

export function ListingsPanel() {
  const [data, setData] = useState<{ study: Study; recent: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/listings")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Не удалось загрузить листинги");
        setData(body);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  const { study, recent } = data;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Новые монеты на OKX: сервер каждые 5 минут проверяет анонсы и список инструментов, собирает сводку по монете и первые 7
        дней цены. Уведомления в Telegram — командой /listings on|off. Движение считается от цены через час после старта торгов.
      </p>

      <section className="space-y-2 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/8">
        <h3 className="text-sm font-medium">Что обычно бывает после листинга ({study.listings} монет)</h3>
        {study.listings ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {study.moves.map((m) => (
              <div key={m.hours} className="rounded-lg bg-white/[0.03] p-2">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">через {HORIZON[m.hours]}</p>
                <p className={cn("text-base font-semibold tabular-nums", tone(m.median))}>медиана {pct(m.median, 0)}</p>
                <p className="text-xs text-muted-foreground">выше в {Math.round(m.shareUp * 100)}% из {m.n}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">История ещё собирается: первые 7 дней каждой монеты загружаются постепенно.</p>
        )}
        <p className={cn("text-sm", study.passed ? "text-emerald-400" : "text-muted-foreground")}>
          {study.passed ? "✅ " : ""}
          {study.bestLabel ? `Лучший вариант сделки — ${study.bestLabel}: ` : ""}
          {study.reason}
        </p>
        <p className="text-xs text-amber-300/80">
          Снятые с торгов монеты OKX не показывает, поэтому в статистику они не попали — для покупки она завышена.
        </p>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-2 font-medium">Монета</th>
              <th className="pr-2 font-medium">Старт торгов</th>
              <th className="pr-2 text-right font-medium">Через 4 ч</th>
              <th className="pr-2 text-right font-medium">Сутки</th>
              <th className="pr-2 text-right font-medium">Неделя</th>
              <th className="pr-2 text-right font-medium">Макс/мин за сутки</th>
              <th className="font-medium">Сводка</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.base} className="border-t border-white/5 align-top">
                <td className="py-1.5 pr-2">
                  {r.announcementUrl ? (
                    <a href={r.announcementUrl} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                      {r.base}
                    </a>
                  ) : (
                    <span className="font-medium">{r.base}</span>
                  )}
                  {r.live && <span className="ml-1 rounded bg-indigo-500/20 px-1 text-[10px] text-indigo-300">новая</span>}
                  <div className="text-[10px] text-muted-foreground">{r.markets}</div>
                </td>
                <td className="pr-2 tabular-nums text-muted-foreground">{date(r.listTime)}</td>
                <td className={cn("pr-2 text-right tabular-nums", tone(r.change4))}>{pct(r.change4)}</td>
                <td className={cn("pr-2 text-right tabular-nums", tone(r.change24))}>{pct(r.change24)}</td>
                <td className={cn("pr-2 text-right tabular-nums", tone(r.change168))}>{pct(r.change168)}</td>
                <td className="pr-2 text-right tabular-nums text-muted-foreground">
                  {pct(r.maxUp24, 0)} / {pct(r.maxDown24, 0)}
                </td>
                <td className="text-muted-foreground">
                  {r.onBinance == null ? "" : r.onBinance ? "есть на Binance" : "нет на Binance"}
                  {r.marketCap ? ` · кап. $${(r.marketCap / 1e6).toFixed(0)} млн` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
