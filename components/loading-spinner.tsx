"use client";

import { motion } from "framer-motion";
import { Loader2, Brain, BarChart3, Newspaper, Sparkles } from "lucide-react";

const STEPS = [
  { icon: BarChart3, text: "Загрузка рыночных данных Binance..." },
  { icon: Brain, text: "Расчёт технических индикаторов..." },
  { icon: Newspaper, text: "Анализ новостей и настроений..." },
  { icon: Sparkles, text: "Генерация AI-прогноза..." },
];

export function LoadingSpinner() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass rounded-2xl p-8 text-center"
    >
      <div className="relative mx-auto mb-6 h-16 w-16">
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 opacity-20 animate-pulse-glow" />
        <div className="absolute inset-2 flex items-center justify-center rounded-full glass">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
        </div>
      </div>

      <h3 className="text-lg font-semibold">Анализируем рынок...</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Собираем данные и формируем прогноз. Это может занять до 60 секунд.
      </p>

      <div className="mt-6 space-y-3">
        {STEPS.map((step, i) => (
          <motion.div
            key={step.text}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.8 }}
            className="flex items-center gap-3 text-sm text-muted-foreground"
          >
            <step.icon className="h-4 w-4 text-indigo-400" />
            {step.text}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
