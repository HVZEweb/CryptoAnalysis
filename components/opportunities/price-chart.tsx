"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dateTime, price as fmtPrice } from "@/components/opportunities/shared";

export interface ChartCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Props {
  candles: ChartCandle[];
  interval: string;
  entry: number;
  tp: number;
  sl: number;
  entryTime: number;
  /** Planned exit time */
  closeBy: number;
  closedAt: number | null;
  exitPrice: number | null;
}

/** Renders at the container's real width, so labels keep their size on a phone and on a monitor. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const LEVELS = [
  { key: "tp", label: "Цель", color: "#34d399" },
  { key: "entry", label: "Вход", color: "#a5b4fc" },
  { key: "sl", label: "Стоп", color: "#f87171" },
] as const;

export function PriceChart({ candles, interval, entry, tp, sl, entryTime, closeBy, closedAt, exitPrice }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = width < 480 ? 240 : 300;
  const pad = { l: 8, r: width < 480 ? 58 : 72, t: 12, b: 24 };

  const scale = useMemo(() => {
    if (!candles.length || !width) return null;
    const lo = Math.min(sl, tp, entry, ...candles.map((c) => c.low), exitPrice ?? entry);
    const hi = Math.max(sl, tp, entry, ...candles.map((c) => c.high), exitPrice ?? entry);
    const span = hi - lo || hi * 0.01;
    const min = lo - span * 0.06;
    const max = hi + span * 0.06;
    const t0 = candles[0].openTime;
    const step = candles.length > 1 ? candles[1].openTime - t0 : 60_000;
    const t1 = candles[candles.length - 1].openTime + step;
    const plotW = width - pad.l - pad.r;
    return {
      x: (t: number) => pad.l + ((t - t0) / (t1 - t0)) * plotW,
      y: (v: number) => pad.t + ((max - v) / (max - min)) * (H - pad.t - pad.b),
      bar: Math.max(1, (step / (t1 - t0)) * plotW * 0.7),
      t0,
      t1,
    };
  }, [candles, width, H, pad.l, pad.r, pad.t, pad.b, entry, tp, sl, exitPrice]);

  const values = { tp, entry, sl };
  const h = hover !== null ? candles[hover] : null;
  const exitT = closedAt ?? null;

  return (
    <div ref={ref} className="relative w-full">
      {!candles.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Нет свечей для графика — Binance не ответил.</p>
      ) : scale ? (
        <>
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={`График цены (${interval}) с уровнями входа, цели и стопа`}
            className="block touch-none select-none"
            onPointerLeave={() => setHover(null)}
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const t = scale.t0 + ((e.clientX - r.left - pad.l) / (width - pad.l - pad.r)) * (scale.t1 - scale.t0);
              let best = 0;
              for (let i = 1; i < candles.length; i++) if (Math.abs(candles[i].openTime - t) < Math.abs(candles[best].openTime - t)) best = i;
              setHover(best);
            }}
          >
            {/* Trade span: from entry to the planned (or actual) exit */}
            <rect
              x={scale.x(entryTime)}
              y={pad.t}
              width={Math.max(0, scale.x(Math.min(exitT ?? closeBy, scale.t1)) - scale.x(entryTime))}
              height={H - pad.t - pad.b}
              fill="rgba(129,140,248,0.07)"
            />
            {LEVELS.map((l) => (
              <g key={l.key}>
                <line x1={pad.l} x2={width - pad.r} y1={scale.y(values[l.key])} y2={scale.y(values[l.key])} stroke={l.color} strokeWidth={1} strokeDasharray={l.key === "entry" ? undefined : "4 3"} opacity={0.85} />
                <text x={width - pad.r + 4} y={scale.y(values[l.key]) + 4} fill={l.color} fontSize={11}>
                  {l.label}
                </text>
              </g>
            ))}
            {candles.map((c, i) => {
              const up = c.close >= c.open;
              const x = scale.x(c.openTime) + scale.bar / 2;
              const color = up ? "#34d399" : "#f87171";
              return (
                <g key={c.openTime} opacity={hover === null || hover === i ? 1 : 0.75}>
                  <line x1={x} x2={x} y1={scale.y(c.high)} y2={scale.y(c.low)} stroke={color} strokeWidth={1} />
                  <rect
                    x={x - scale.bar / 2}
                    y={scale.y(Math.max(c.open, c.close))}
                    width={scale.bar}
                    height={Math.max(1, Math.abs(scale.y(c.open) - scale.y(c.close)))}
                    fill={color}
                    rx={scale.bar > 4 ? 1 : 0}
                  />
                </g>
              );
            })}
            <circle cx={scale.x(entryTime)} cy={scale.y(entry)} r={4.5} fill="#a5b4fc" stroke="#0d0d14" strokeWidth={2} />
            {exitT != null && exitPrice != null && exitT <= scale.t1 && (
              <circle cx={scale.x(exitT)} cy={scale.y(exitPrice)} r={4.5} fill="#fbbf24" stroke="#0d0d14" strokeWidth={2} />
            )}
            {[scale.t0, (scale.t0 + scale.t1) / 2, scale.t1].map((t, i) => (
              <text key={t} x={i === 0 ? pad.l : i === 1 ? scale.x(t) : width - pad.r} y={H - 6} fontSize={10} fill="#8b92a8" textAnchor={i === 0 ? "start" : i === 1 ? "middle" : "end"}>
                {dateTime(t)}
              </text>
            ))}
            {h && hover !== null && (
              <line x1={scale.x(h.openTime) + scale.bar / 2} x2={scale.x(h.openTime) + scale.bar / 2} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.25)" />
            )}
          </svg>
          {h && (
            <div className="pointer-events-none absolute left-2 top-2 rounded-lg bg-black/80 px-2 py-1 text-[11px] tabular-nums ring-1 ring-white/10">
              {dateTime(h.openTime)} · O {fmtPrice(h.open)} · H {fmtPrice(h.high)} · L {fmtPrice(h.low)} · C {fmtPrice(h.close)}
            </div>
          )}
        </>
      ) : (
        <div style={{ height: H }} />
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-300" /> вход
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-400" /> выход
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-indigo-400/15" /> время сделки
        </span>
        <span>свечи {interval}, время МСК</span>
      </div>
    </div>
  );
}
