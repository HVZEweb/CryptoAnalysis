"use client";

import { useEffect, useState } from "react";
import type { MarketType } from "@/types";

interface LivePriceData {
  price: number;
  priceChangePercent24h: number;
  loading: boolean;
  error: string | null;
}

export function useLivePrice(symbol: string | undefined, market: MarketType) {
  const [data, setData] = useState<LivePriceData>({
    price: 0,
    priceChangePercent24h: 0,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!symbol) {
      setData({ price: 0, priceChangePercent24h: 0, loading: false, error: null });
      return;
    }

    let cancelled = false;

    const fetchPrice = async () => {
      setData((prev) => ({ ...prev, loading: prev.price === 0, error: null }));
      try {
        const res = await fetch(`/api/price?symbol=${encodeURIComponent(symbol)}&market=${market}`);
        if (!res.ok) throw new Error("Ошибка загрузки");
        const json = (await res.json()) as {
          price: number;
          priceChangePercent24h: number;
        };
        if (!cancelled) {
          setData({
            price: json.price,
            priceChangePercent24h: json.priceChangePercent24h,
            loading: false,
            error: null,
          });
        }
      } catch {
        if (!cancelled) {
          setData((prev) => ({ ...prev, loading: false, error: "Цена недоступна" }));
        }
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol, market]);

  return data;
}
