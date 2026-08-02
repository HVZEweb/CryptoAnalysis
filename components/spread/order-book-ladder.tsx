"use client";

export type BookLevel = [string, string] | { price: string | number; size: string | number };

function parseLevel(level: BookLevel): { price: number; usd: number } {
  if (Array.isArray(level)) {
    const price = parseFloat(level[0]);
    const size = parseFloat(level[1]);
    return { price, usd: price * size };
  }
  const price = parseFloat(String(level.price));
  const size = parseFloat(String(level.size));
  return { price, usd: price * size };
}

interface OrderBookLadderProps {
  bids: BookLevel[];
  asks: BookLevel[];
  targetPrice?: number | null;
}

export function OrderBookLadder({ bids, asks, targetPrice }: OrderBookLadderProps) {
  const bidLevels = bids.slice(0, 8).map(parseLevel);
  const askLevels = asks.slice(0, 8).map(parseLevel);
  const maxUsd = Math.max(...bidLevels.map((l) => l.usd), ...askLevels.map((l) => l.usd), 1);

  return (
    <div className="rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/5 font-mono text-[11px]">
      <p className="mb-2 text-xs text-muted-foreground">Стакан (live)</p>
      <div className="space-y-0.5">
        {[...askLevels].reverse().map((l, i) => (
          <div key={`a${i}`} className="relative flex items-center justify-between py-0.5">
            <div
              className="absolute right-0 top-0 h-full bg-red-500/10"
              style={{ width: `${(l.usd / maxUsd) * 100}%` }}
            />
            <span className="relative text-red-400">${l.price.toFixed(2)}</span>
            <span className="relative text-muted-foreground">${l.usd.toFixed(0)}</span>
          </div>
        ))}
        <div className="border-y border-white/10 py-1 my-1 text-center text-amber-400">
          {targetPrice ? `▸ цель $${targetPrice.toFixed(2)}` : "— спред —"}
        </div>
        {bidLevels.map((l, i) => (
          <div key={`b${i}`} className="relative flex items-center justify-between py-0.5">
            <div
              className="absolute right-0 top-0 h-full bg-emerald-500/10"
              style={{ width: `${(l.usd / maxUsd) * 100}%` }}
            />
            <span className="relative text-emerald-400">${l.price.toFixed(2)}</span>
            <span className="relative text-muted-foreground">${l.usd.toFixed(0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
