"use client";

export interface CandlePoint {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

interface CandleChartProps {
  candles: CandlePoint[];
  entryPrice?: number;
  targetPrice?: number;
  height?: number;
}

export function CandleChart({ candles, entryPrice, targetPrice, height = 160 }: CandleChartProps) {
  if (!candles.length) {
    return (
      <div
        className="flex items-center justify-center rounded-xl bg-white/[0.02] text-xs text-muted-foreground"
        style={{ height }}
      >
        Загрузка свечей…
      </div>
    );
  }

  const w = 100;
  const prices = candles.flatMap((c) => [c.h, c.l]);
  if (entryPrice) prices.push(entryPrice);
  if (targetPrice) prices.push(targetPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const barW = w / candles.length;

  const y = (price: number) => height - ((price - min) / range) * (height - 8) - 4;

  return (
    <div className="relative rounded-xl bg-white/[0.02] p-2 ring-1 ring-white/5">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }}>
        {candles.map((c, i) => {
          const x = i * barW + barW * 0.2;
          const bw = barW * 0.6;
          const bullish = c.c >= c.o;
          const color = bullish ? "#34d399" : "#f87171";
          const bodyTop = y(Math.max(c.o, c.c));
          const bodyBot = y(Math.min(c.o, c.c));
          const bodyH = Math.max(bodyBot - bodyTop, 0.5);
          return (
            <g key={c.t}>
              <line x1={x + bw / 2} y1={y(c.h)} x2={x + bw / 2} y2={y(c.l)} stroke={color} strokeWidth={0.4} />
              <rect x={x} y={bodyTop} width={bw} height={bodyH} fill={color} opacity={0.9} />
            </g>
          );
        })}
        {targetPrice && (
          <line
            x1={0}
            y1={y(targetPrice)}
            x2={w}
            y2={y(targetPrice)}
            stroke="#fbbf24"
            strokeWidth={0.5}
            strokeDasharray="2 2"
          />
        )}
        {entryPrice && (
          <line
            x1={0}
            y1={y(entryPrice)}
            x2={w}
            y2={y(entryPrice)}
            stroke="#22d3ee"
            strokeWidth={0.5}
            strokeDasharray="2 2"
          />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground font-mono">
        <span>${min.toFixed(2)}</span>
        <span>1m · {candles.length} свечей</span>
        <span>${max.toFixed(2)}</span>
      </div>
      {(entryPrice || targetPrice) && (
        <div className="mt-1 flex gap-3 text-[10px]">
          {targetPrice && <span className="text-amber-400">— цель входа</span>}
          {entryPrice && <span className="text-cyan-400">— вход в позиции</span>}
        </div>
      )}
    </div>
  );
}
