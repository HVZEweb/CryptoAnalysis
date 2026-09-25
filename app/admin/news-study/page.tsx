"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LiveStudy } from "@/services/news-study/log";
import type { HorizonKey } from "@/services/news-study/study";
import { cn } from "@/lib/utils";

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

export default function NewsStudyPage() {
  const [data, setData] = useState<LiveStudy | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/news-study")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Не удалось загрузить");
        setData(body as LiveStudy);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Как новости двигают цену</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Каждая новость из мониторинга записывается с типом; через сутки по свечам Binance считается, куда пошёл BTC
            через 15 мин, 1, 4 и 24 ч. «К обычному» — разница со средним ходом BTC за тот же срок в любой час; «×» —
            во сколько раз ход больше обычного. Одна история, пересказанная разными изданиями за 6 часов, считается один раз.
          </p>
        </div>
        <Link href="/admin" className="shrink-0 text-sm text-indigo-300 hover:underline">
          ← Админка
        </Link>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {data && (
        <>
          <p className="text-sm text-muted-foreground">
            Записано новостей: {data.logged}
            {data.since ? ` с ${new Date(data.since).toLocaleDateString("ru-RU")}` : ""} · с известным исходом и типом:{" "}
            {data.measured}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Тип новости</th>
                  <th className="py-2 pr-3">Событий</th>
                  {(["m15", "h1", "h4", "h24"] as HorizonKey[]).map((k) => (
                    <th key={k} className="py-2 pr-3">
                      {{ m15: "15 мин", h1: "1 ч", h4: "4 ч", h24: "24 ч" }[k]}
                    </th>
                  ))}
                  <th className="py-2">Вывод</th>
                </tr>
              </thead>
              <tbody>
                {data.topics.map((t) => (
                  <tr key={t.topic} className="border-t border-white/5 align-top">
                    <td className="py-2 pr-3 font-medium">{t.label}</td>
                    <td className="py-2 pr-3 tabular-nums">{t.events}</td>
                    {(["m15", "h1", "h4", "h24"] as HorizonKey[]).map((k) => {
                      const h = t.horizons[k];
                      return (
                        <td key={k} className="py-2 pr-3 tabular-nums text-xs">
                          {h ? (
                            <>
                              <span className={h.meanPct >= 0 ? "text-emerald-400" : "text-red-400"}>{pct(h.meanPct)}</span>
                              <br />
                              {Math.round(h.upShare * 100)}%↑ · ×{h.sizeRatio.toFixed(1)}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                    <td
                      className={cn(
                        "py-2 text-xs",
                        t.verdict === "up" && "text-emerald-400",
                        t.verdict === "down" && "text-red-400",
                        t.verdict === "volatile" && "text-amber-300",
                        (t.verdict === "none" || t.verdict === "few") && "text-muted-foreground"
                      )}
                    >
                      {t.summary}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.topics.length && (
            <p className="text-sm text-muted-foreground">Пока нет новостей с известным исходом: он появляется через сутки после новости.</p>
          )}
        </>
      )}
    </main>
  );
}
