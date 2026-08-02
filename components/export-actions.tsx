"use client";

import { useState } from "react";
import { Check, Copy, Printer, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PredictionResult } from "@/types";
import { resolvePriceForecast, formatMovePct } from "@/lib/price-forecast";
import { CONFIDENCE_LABELS, DIRECTION_CONFIG, TIMEFRAME_LABELS, formatPrice } from "@/lib/utils";

interface ExportActionsProps {
  prediction: PredictionResult;
}

export function ExportActions({ prediction }: ExportActionsProps) {
  const [toast, setToast] = useState<string | null>(null);

  const dir = DIRECTION_CONFIG[prediction.direction];
  const forecast = resolvePriceForecast(prediction);
  const text = [
    `${prediction.coin} (${prediction.symbol})`,
    `Направление: ${dir.label}`,
    `Целевая цена: $${formatPrice(forecast.predictedPrice)} (${formatMovePct(forecast.expectedMovePct)})`,
    `Коридор: $${formatPrice(forecast.confidenceBand.low)} — $${formatPrice(forecast.confidenceBand.high)}`,
    `Вероятность: ${prediction.probability}%`,
    `Уверенность: ${CONFIDENCE_LABELS[prediction.confidence]}`,
    `Таймфрейм: ${TIMEFRAME_LABELS[prediction.timeframe]}`,
    `Диапазон: $${formatPrice(prediction.priceRange.low)} — $${formatPrice(prediction.priceRange.high)}`,
    `Рекомендация: ${prediction.recommendation}`,
    prediction.disclaimer,
  ].join("\n");

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    notify("Скопировано в буфер");
  };

  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({ title: "AI Crypto Predictor", text });
      notify("Отправлено");
    } else {
      await handleCopy();
    }
  };

  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<pre style="font-family:system-ui;padding:32px;max-width:600px">${text}</pre>`);
    win.print();
    notify("Открыта печать / PDF");
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={handleCopy} className="rounded-xl">
          <Copy className="h-4 w-4" /> Копировать
        </Button>
        <Button variant="secondary" size="sm" onClick={handleShare} className="rounded-xl">
          <Share2 className="h-4 w-4" /> Поделиться
        </Button>
        <Button variant="secondary" size="sm" onClick={handlePrint} className="rounded-xl">
          <Printer className="h-4 w-4" /> PDF
        </Button>
      </div>
      {toast && (
        <div className="absolute -top-10 left-0 flex items-center gap-2 rounded-full bg-emerald-500/20 px-4 py-1.5 text-xs text-emerald-300 ring-1 ring-emerald-500/30">
          <Check className="h-3.5 w-3.5" /> {toast}
        </div>
      )}
    </div>
  );
}
