"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Image from "next/image";
import { Check, ChevronRight, Coins, Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Coin } from "@/types";

const POPULAR = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "TON", "ADA"];

interface CoinSelectProps {
  value: Coin | null;
  onChange: (coin: Coin) => void;
}

export function CoinSelect({ value, onChange }: CoinSelectProps) {
  const [open, setOpen] = useState(false);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");

  const loadCoins = () => {
    setLoading(true);
    setError(false);
    axios.get<{ coins: Coin[] }>("/api/coins").then((res) => setCoins(res.data.coins)).catch(() => setError(true)).finally(() => setLoading(false));
  };

  useEffect(() => { loadCoins(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return coins;
    return coins.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  }, [coins, search]);

  const popular = useMemo(() => POPULAR.map((s) => coins.find((c) => c.symbol === s)).filter((c): c is Coin => !!c), [coins]);

  const select = (coin: Coin) => { onChange(coin); setOpen(false); setSearch(""); };

  return (
    <>
      <button type="button" onClick={() => { if (error) loadCoins(); else if (!loading) setOpen(true); }} disabled={loading}
        className="group flex w-full items-center gap-4 rounded-2xl border border-border bg-input p-4 text-left transition-all hover:border-indigo-500/40 hover:bg-indigo-500/5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20">
          {loading ? <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
            : value?.image ? <Image src={value.image} alt={value.symbol} width={48} height={48} className="h-full w-full object-cover" />
            : value ? <span className="text-sm font-bold text-indigo-300">{value.symbol.slice(0, 3)}</span>
            : <Coins className="h-5 w-5 text-indigo-400" />}
        </div>
        <div className="min-w-0 flex-1">
          {loading ? <p className="text-sm text-muted-foreground">Загрузка...</p>
            : error ? <p className="text-sm text-destructive">Ошибка. Нажмите для повтора.</p>
            : value ? <><p className="font-semibold">{value.name}</p><p className="text-sm text-indigo-400">{value.symbol}</p></>
            : <><p className="font-medium">Выбрать криптовалюту</p><p className="text-sm text-muted-foreground">Открыть каталог</p></>}
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-indigo-400" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
            <DialogTitle>Выберите криптовалюту</DialogTitle>
            <DialogDescription>Поиск по тикеру или названию</DialogDescription>
          </DialogHeader>
          <div className="px-6 pt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="BTC, Ethereum..."
                className="h-11 w-full rounded-xl border border-border bg-white/5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30" autoFocus />
            </div>
            {!search && (
              <div className="mt-3 flex flex-wrap gap-2">
                {popular.map((coin) => (
                  <button key={coin.id} type="button" onClick={() => select(coin)}
                    className={cn("rounded-full px-3 py-1.5 text-sm", value?.id === coin.id ? "bg-indigo-500 text-white" : "bg-white/5 hover:bg-indigo-500/20")}>
                    {coin.symbol}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3 flex-1 overflow-y-auto px-3 pb-4">
            {filtered.slice(0, search ? filtered.length : 100).map((coin) => (
              <button key={coin.id} type="button" onClick={() => select(coin)}
                className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/5", value?.id === coin.id && "bg-indigo-500/20")}>
                {coin.image ? <Image src={coin.image} alt="" width={40} height={40} className="rounded-lg" /> : <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-xs font-bold text-indigo-300">{coin.symbol.slice(0, 4)}</div>}
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{coin.name}</p><p className="text-sm text-muted-foreground">{coin.symbol}</p></div>
                {value?.id === coin.id && <Check className="h-5 w-5 text-indigo-400" />}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
