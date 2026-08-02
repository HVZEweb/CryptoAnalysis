"use client";

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { PipelineStep } from "@/lib/progress";
import { PIPELINE_STEP_LABELS } from "@/lib/progress";
import { cn } from "@/lib/utils";

interface ProgressBarProps {
  progress: number;
  step: PipelineStep | null;
  message: string;
  /** Большой блок в зоне прогноза */
  variant?: "compact" | "hero";
}

export function ProgressBar({ progress, step, message, variant = "compact" }: ProgressBarProps) {
  const isHero = variant === "hero";

  return (
    <div
      className={cn(
        "card-premium gradient-border flex flex-col justify-center rounded-3xl",
        isHero ? "min-h-[40vh] flex-1 p-8 sm:p-10" : "rounded-2xl p-4"
      )}
    >
      {isHero && (
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/25 to-violet-500/10 ring-1 ring-indigo-500/25">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
          </div>
          <h3 className="font-display text-xl font-semibold">Формируем прогноз</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Загружаем данные Binance, считаем индикаторы и запрашиваем AI-модель
          </p>
        </div>
      )}

      <div className={cn(isHero && "mx-auto w-full max-w-lg")}>
        <div className="mb-3 flex items-center justify-between">
          <span className={cn("font-medium text-indigo-300", isHero ? "text-sm" : "text-xs")}>
            {step ? PIPELINE_STEP_LABELS[step] : "Анализ"}
          </span>
          <span className={cn("font-display font-bold text-foreground", isHero ? "text-2xl" : "text-sm")}>
            {progress}%
          </span>
        </div>
        <div className={cn("overflow-hidden rounded-full bg-white/5 ring-1 ring-white/5", isHero ? "h-3" : "h-2")}>
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-400"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
        <p className={cn("mt-3 text-muted-foreground", isHero ? "text-sm text-center" : "text-xs")}>{message}</p>
        {step === "ai_analysis" && (
          <p className={cn("mt-1 text-muted-foreground/70", isHero ? "text-center text-xs" : "text-[10px]")}>
            Основное ожидание — ответ модели OpenRouter
          </p>
        )}
        {step === "ensemble" && (
          <p className={cn("mt-1 text-muted-foreground/70", isHero ? "text-center text-xs" : "text-[10px]")}>
            ML-модель + rule-based сигналы + взвешенное голосование
          </p>
        )}
      </div>
    </div>
  );
}
