"use client";

import { useEffect, useState } from "react";
import { Activity, Bitcoin, Globe } from "lucide-react";
import { cn, formatNumber, formatPrice } from "@/lib/utils";

interface TopCoin {
  symbol: string;
  price: number;
  change24h: number;
}

interface MarketOverviewData {
  fearGreed: { value: number; classification: string };
  btcDominance: { dominance: number; change24h: number };
  globalMarket: { totalMarketCap: number; marketCapChange24h: number };
  topCoins: TopCoin[];
}

function Divider() {
  return <div className="hidden h-3 w-px shrink-0 bg-white/10 sm:block" />;
}

export function MarketOverview() {
  const [data, setData] = useState<MarketOverviewData | null>(null);

  useEffect(() => {
    fetch("/api/market-overview")
      .then((r) => r.json())
      .then(setData)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/stream/prices");

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type: string;
          quotes?: TopCoin[];
        };
        if (payload.type !== "quotes" || !payload.quotes?.length) return;
        setData((prev) => {
          if (!prev) return prev;
          const bySymbol = new Map(payload.quotes!.map((q) => [q.symbol, q]));
          return {
            ...prev,
            topCoins: prev.topCoins.map((coin) => bySymbol.get(coin.symbol) ?? coin),
          };
        });
      } catch {
        // ignore malformed SSE
      }
    };

    return () => source.close();
  }, []);

  if (!data) {
    return (
      <div className="stat-pill flex gap-3 overflow-x-auto px-4 py-2.5 shimmer">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-4 w-24 shrink-0 rounded-full bg-white/5" />
        ))}
      </div>
    );
  }

  const fgColor =
    data.fearGreed.value >= 55
      ? "text-emerald-400"
      : data.fearGreed.value <= 45
        ? "text-red-400"
        : "text-amber-400";

  return (
    <div className="stat-pill flex items-center gap-x-4 gap-y-2 overflow-x-auto px-4 py-2.5 text-xs">
      {data.topCoins?.map((coin) => {
        const up = coin.change24h >= 0;
        return (
          <div key={coin.symbol} className="flex shrink-0 items-center gap-2">
            <span className="font-semibold text-foreground">{coin.symbol}</span>
            <span className="font-medium tabular-nums text-foreground/90">${formatPrice(coin.price)}</span>
            <span className={cn("font-medium tabular-nums", up ? "text-emerald-400" : "text-red-400")}>
              {up ? "+" : ""}
              {coin.change24h.toFixed(2)}%
            </span>
          </div>
        );
      })}

      <Divider />

      <div className="flex shrink-0 items-center gap-2">
        <Activity className={cn("h-3.5 w-3.5", fgColor)} />
        <span className="text-muted-foreground">Fear & Greed</span>
        <span className={cn("font-semibold", fgColor)}>{data.fearGreed.value}</span>
        <span className="hidden text-muted-foreground/70 sm:inline">{data.fearGreed.classification}</span>
      </div>

      <Divider />

      <div className="flex shrink-0 items-center gap-2">
        <Bitcoin className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-muted-foreground">BTC Dom</span>
        <span className="font-semibold">{data.btcDominance.dominance.toFixed(1)}%</span>
        <span className={data.btcDominance.change24h >= 0 ? "text-emerald-400" : "text-red-400"}>
          {data.btcDominance.change24h >= 0 ? "+" : ""}
          {data.btcDominance.change24h.toFixed(2)}%
        </span>
      </div>

      <Divider />

      <div className="flex shrink-0 items-center gap-2">
        <Globe className="h-3.5 w-3.5 text-sky-400" />
        <span className="text-muted-foreground">Рынок</span>
        <span className="font-semibold">${formatNumber(data.globalMarket.totalMarketCap)}</span>
        <span
          className={
            data.globalMarket.marketCapChange24h >= 0 ? "text-emerald-400" : "text-red-400"
          }
        >
          {data.globalMarket.marketCapChange24h >= 0 ? "+" : ""}
          {data.globalMarket.marketCapChange24h.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}
