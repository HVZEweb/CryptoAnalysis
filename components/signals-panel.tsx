"use client";

import { useEffect, useMemo, useState } from "react";
import { cn, formatPrice } from "@/lib/utils";

interface SignalRow {
  id: number;
  symbol: string;
  timeframe: string;
  model: string;
  side: "LONG" | "SHORT";
  entry: number;
  tp: number;
  sl: number;
  sentAt: number;
  closeBy: number;
  status: "open" | "tp" | "sl" | "timeout";
  exitPrice: number | null;
  netBp: number | null;
  closedAt: number | null;
  demoStatus: "open" | "closing" | "closed" | "failed" | null;
  demoNetBp: number | null;
}

interface SignalsData {
  record: { closed: number; wins: number; avgNetBp: number; sumNetPct: number };
  /** Same signals as really executed on the OKX demo account */
  demo: { closed: number; wins: number; avgNetBp: number; sumNetPct: number } | null;
  curve: Array<{ t: number; pct: number }>;
  open: SignalRow[];
  recent: SignalRow[];
}

const STATUS: Record<SignalRow["status"], string> = { open: "открыт", tp: "цель", sl: "стоп", timeout: "по времени" };
const date = (t: number) => new Date(t).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

function Tile({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/8">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold tabular-nums", tone === "up" && "text-emerald-400", tone === "down" && "text-red-400")}>{value}</p>
    </div>
  );
}

/** Cumulative result after costs, % of one position per signal. One series: the title names it, no legend. */
function EquityChart({ curve }: { curve: SignalsData["curve"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 180;
  const pad = { l: 44, r: 12, t: 12, b: 22 };
  const points = useMemo(() => [{ t: curve[0].t, pct: 0 }, ...curve], [curve]);
  const min = Math.min(0, ...points.map((p) => p.pct));
  const max = Math.max(0, ...points.map((p) => p.pct));
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((max - v) / span) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(" ");
  const h = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Накопленный результат сигналов после комиссий"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
      >
        {[max, 0, min].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? "stroke-white/25" : "stroke-white/8"} strokeWidth={1} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {signed(v, 1)}%
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#818cf8" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {h && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="stroke-white/20" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(h.pct)} r={4} fill="#818cf8" stroke="#0d0d14" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-1 rounded-lg bg-black/80 px-2 py-1 text-[11px] ring-1 ring-white/10"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: "translateX(-50%)" }}
        >
          {hover === 0 ? "начало" : `${hover}-й сигнал · ${date(h.t)}`} · <span className="tabular-nums">{signed(h.pct)}%</span>
        </div>
      )}
    </div>
  );
}

function SignalTable({ rows }: { rows: SignalRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-xs">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1.5 pr-2 font-medium">Отправлен</th>
            <th className="pr-2 font-medium">Сигнал</th>
            <th className="pr-2 text-right font-medium">Вход</th>
            <th className="pr-2 text-right font-medium">Выход</th>
            <th className="pr-2 font-medium">Итог</th>
            <th className="pr-2 text-right font-medium">После комиссий</th>
            <th className="text-right font-medium">Демо OKX</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="border-t border-white/5">
              <td className="py-1.5 pr-2 tabular-nums text-muted-foreground">{date(s.sentAt)}</td>
              <td className="pr-2">
                <span className={s.side === "LONG" ? "text-emerald-400" : "text-red-400"}>{s.side}</span> {s.symbol}{" "}
                <span className="text-muted-foreground">
                  {s.timeframe} · {s.model}
                </span>
              </td>
              <td className="pr-2 text-right tabular-nums">{formatPrice(s.entry)}</td>
              <td className="pr-2 text-right tabular-nums">{s.exitPrice != null ? formatPrice(s.exitPrice) : "—"}</td>
              <td className="pr-2">{STATUS[s.status]}</td>
              <td className={cn("text-right tabular-nums", (s.netBp ?? 0) > 0 && "text-emerald-400", (s.netBp ?? 0) < 0 && "text-red-400")}>
                {s.netBp != null ? `${signed(s.netBp / 100)}%` : "—"}
              </td>
              <td className="text-right tabular-nums text-muted-foreground">
                {s.demoNetBp != null ? `${signed(s.demoNetBp / 100)}%` : s.demoStatus === "failed" ? "не открыт" : s.demoStatus ? "идёт" : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SignalsPanel() {
  const [data, setData] = useState<SignalsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/signals")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Не удалось загрузить сигналы");
        setData(body as SignalsData);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Загрузка…</p>;

  const r = data.record;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Реальные результаты сигналов, отправленных в Telegram: каждый закрыт по цели, стопу или времени, с комиссиями и
        проскальзыванием (вход и стоп рыночными, цель лимитным). Результат — % от суммы одной позиции.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Закрыто сигналов" value={String(r.closed)} />
        <Tile label="В плюс" value={r.closed ? `${Math.round((r.wins / r.closed) * 100)}%` : "—"} />
        <Tile label="В среднем" value={r.closed ? `${signed(r.avgNetBp / 100)}%` : "—"} tone={r.avgNetBp > 0 ? "up" : r.avgNetBp < 0 ? "down" : undefined} />
        <Tile label="Всего" value={r.closed ? `${signed(r.sumNetPct)}%` : "—"} tone={r.sumNetPct > 0 ? "up" : r.sumNetPct < 0 ? "down" : undefined} />
      </div>
      {data.demo && (
        <p className="text-sm text-muted-foreground">
          На демо-счёте OKX с реальным исполнением: {data.demo.closed} сделок, в среднем{" "}
          <span className={data.demo.avgNetBp >= 0 ? "text-emerald-400" : "text-red-400"}>{signed(data.demo.avgNetBp / 100)}%</span>, всего{" "}
          {signed(data.demo.sumNetPct)}%.
        </p>
      )}

      {data.curve.length > 1 ? (
        <section className="space-y-1">
          <h3 className="text-sm font-medium">Накопленный результат после комиссий</h3>
          <EquityChart curve={data.curve} />
        </section>
      ) : (
        <p className="rounded-xl bg-white/[0.03] p-4 text-sm text-muted-foreground ring-1 ring-white/8">
          Закрытых сигналов пока {data.curve.length ? "один" : "нет"}. Сигнал приходит, только если настройка сделок прибыльна после
          комиссий на истории, которую не видела при подборе, — поэтому их может долго не быть. Монеты для слежения задаются боту
          командой /watch.
        </p>
      )}

      {data.open.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-sm font-medium">Открыты сейчас</h3>
          <SignalTable rows={data.open} />
        </section>
      )}
      {data.recent.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-sm font-medium">Последние закрытые</h3>
          <SignalTable rows={data.recent} />
        </section>
      )}
    </div>
  );
}
