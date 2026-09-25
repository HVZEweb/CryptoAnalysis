"use client";

import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { CoinSelect } from "@/components/coin-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { predictionFormSchema, type PredictionFormValues } from "@/lib/schemas";
import { getFormModelOptions } from "@/lib/ai-models";
import { useLivePrice } from "@/hooks/use-live-price";
import { cn, formatPrice } from "@/lib/utils";
import type { Coin, QuotaStatus } from "@/types";

interface PredictionFormProps {
  onSubmit: (data: PredictionFormValues) => void;
  loading: boolean;
  defaultSymbol?: string;
  quota?: QuotaStatus | null;
  onNeedAuth?: () => void;
  onNeedUpgrade?: () => void;
}

const DEFAULT_MODEL = "__default__";

interface TimeframeStatus {
  timeframe: string;
  hasEdge: boolean;
  tradeProfitable: boolean;
}

/** What the model of each timeframe can offer, as a short suffix for the selector. */
function timeframeNote(s: TimeframeStatus | undefined): string {
  if (!s) return "";
  if (s.tradeProfitable) return " · проверенные сделки";
  if (s.hasEdge) return " · направление";
  return " · только коридор цены";
}

const TIMEFRAMES = [
  { value: "15m", label: "15 минут" },
  { value: "30m", label: "30 минут" },
  { value: "1h", label: "1 час" },
  { value: "4h", label: "4 часа" },
  { value: "12h", label: "12 часов" },
  { value: "24h", label: "24 часа" },
  { value: "3d", label: "3 дня" },
  { value: "7d", label: "7 дней" },
] as const;

export function PredictionForm({
  onSubmit,
  loading,
  defaultSymbol,
  quota,
  onNeedAuth,
  onNeedUpgrade,
}: PredictionFormProps) {
  const [selectedCoin, setSelectedCoin] = useState<Coin | null>(null);
  const [tfStatus, setTfStatus] = useState<Record<string, TimeframeStatus>>({});

  useEffect(() => {
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { timeframes: TimeframeStatus[] } | null) => {
        if (d) setTfStatus(Object.fromEntries(d.timeframes.map((t) => [t.timeframe, t])));
      })
      .catch(() => undefined);
  }, []);

  const { control, handleSubmit, setValue, reset, watch, formState: { errors } } = useForm<PredictionFormValues>({
    resolver: zodResolver(predictionFormSchema),
    defaultValues: { coinSymbol: defaultSymbol ?? "", market: "Futures", timeframe: "1h", model: DEFAULT_MODEL },
  });

  const watchedMarket = watch("market");
  const watchedSymbol = watch("coinSymbol");
  const livePrice = useLivePrice(watchedSymbol || undefined, watchedMarket);

  useEffect(() => {
    if (defaultSymbol) {
      reset({ coinSymbol: defaultSymbol, market: "Futures", timeframe: "1h" });
      setSelectedCoin((prev) => (prev?.symbol === defaultSymbol ? prev : { id: defaultSymbol, symbol: defaultSymbol, name: defaultSymbol }));
    }
  }, [defaultSymbol, reset]);

  const handleCoinChange = (coin: Coin) => {
    setSelectedCoin(coin);
    setValue("coinSymbol", coin.symbol, { shouldValidate: true });
  };

  const noQuota = quota && quota.remaining <= 0 && quota.tier !== "paid";

  return (
    <form
      onSubmit={handleSubmit((data) =>
        onSubmit({
          ...data,
          model: data.model && data.model !== DEFAULT_MODEL ? data.model.trim() : undefined,
        })
      )}
      className="card-premium gradient-border space-y-5 rounded-3xl p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-sm font-semibold text-foreground">Новый прогноз</p>
          <p className="text-xs text-muted-foreground">Binance + 18 индикаторов + AI</p>
        </div>
        {quota && quota.tier !== "paid" && (
          <span className="shrink-0 rounded-lg bg-indigo-500/10 px-2 py-1 text-[10px] font-medium text-indigo-200 ring-1 ring-indigo-500/20">
            {quota.remaining}/{quota.limit}
          </span>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Криптовалюта</Label>
        <CoinSelect value={selectedCoin} onChange={handleCoinChange} />
        {errors.coinSymbol && <p className="text-sm text-destructive">{errors.coinSymbol.message}</p>}
        {watchedSymbol && (
          <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/5">
            <span className="text-xs text-muted-foreground">Текущая цена</span>
            {livePrice.loading && livePrice.price === 0 ? (
              <span className="text-xs text-muted-foreground">Загрузка...</span>
            ) : livePrice.error ? (
              <span className="text-xs text-muted-foreground">{livePrice.error}</span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-display text-sm font-semibold tabular-nums">${formatPrice(livePrice.price)}</span>
                <span
                  className={cn(
                    "flex items-center gap-0.5 text-xs font-medium",
                    livePrice.priceChangePercent24h >= 0 ? "text-emerald-400" : "text-red-400"
                  )}
                >
                  {livePrice.priceChangePercent24h >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {livePrice.priceChangePercent24h >= 0 ? "+" : ""}
                  {livePrice.priceChangePercent24h.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Рынок</Label>
          <Controller name="market" control={control} render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="rounded-xl border-white/8 bg-white/5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Spot">Spot</SelectItem>
                <SelectItem value="Futures">Futures</SelectItem>
              </SelectContent>
            </Select>
          )} />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Таймфрейм</Label>
          <Controller name="timeframe" control={control} render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="rounded-xl border-white/8 bg-white/5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf.value} value={tf.value}>
                    {tf.label}
                    <span className="text-muted-foreground">{timeframeNote(tfStatus[tf.value])}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )} />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">ИИ для текста объяснения</Label>
        <Controller name="model" control={control} render={({ field }) => (
          <Select value={field.value ?? DEFAULT_MODEL} onValueChange={field.onChange}>
            <SelectTrigger className="rounded-xl border-white/8 bg-white/5"><SelectValue placeholder="По умолчанию" /></SelectTrigger>
            <SelectContent>
              {getFormModelOptions().map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )} />
      </div>

      {noQuota ? (
        <Button
          type="button"
          size="lg"
          className="h-12 w-full rounded-xl text-base"
          onClick={() => (quota?.requiresPayment ? onNeedUpgrade?.() : onNeedAuth?.())}
        >
          <Sparkles className="h-5 w-5" />
          {quota?.requiresPayment ? "Купить доступ" : "Зарегистрироваться (+2)"}
        </Button>
      ) : (
        <Button type="submit" size="lg" className="h-12 w-full rounded-xl text-base" disabled={loading}>
          <Sparkles className="h-5 w-5" />
          {loading ? "Анализируем рынок..." : "Получить AI-прогноз"}
        </Button>
      )}
    </form>
  );
}
