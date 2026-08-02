"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wrench, X, FlaskConical, History, BarChart3, ClipboardList, Microscope, BookMarked, LineChart, Radar } from "lucide-react";
import Link from "next/link";

export function DevMenu() {
  const [isOpen, setIsOpen] = useState(false);

  const menuItems = [
    {
      href: "/news-impact",
      icon: Radar,
      label: "News Impact",
      description: "Мониторинг новостей · impact score · срочность",
    },
    {
      href: "/backtest",
      icon: LineChart,
      label: "Backtest Panel",
      description: "Backtest, export JSONL, live performance monitoring",
    },
    {
      href: "/alpha-registry",
      icon: BookMarked,
      label: "Alpha Registry",
      description: "Реестр гипотез · validated → бот",
    },
    {
      href: "/continuous-research",
      icon: FlaskConical,
      label: "Continuous Research",
      description: "MSB: сбор данных, ежедневно/еженедельно",
    },
    {
      href: "/execution-lab",
      icon: Microscope,
      label: "Execution Intelligence Lab",
      description: "Исполнение крупных ордеров, TWAP/VWAP",
    },
    {
      href: "/maintenance",
      icon: ClipboardList,
      label: "Maintenance Mode",
      description: "Phase X, архив данных, отчёты",
    },
    {
      href: "/spread",
      icon: Wrench,
      label: "Spread Trading Bot",
      description: "Автоматический сбор спреда OKX",
    },
    {
      href: "/check-prediction",
      icon: FlaskConical,
      label: "Проверка точности",
      description: "Оценка последнего прогноза",
    },
    {
      href: "/api/predictions/latest",
      icon: History,
      label: "API: Последний прогноз",
      description: "JSON последнего прогноза",
      external: true,
    },
    {
      href: "/api/status",
      icon: BarChart3,
      label: "API: Статус системы",
      description: "Диагностика OpenRouter",
      external: true,
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:border-indigo-500/30 hover:bg-indigo-500/10 hover:text-indigo-400"
        title="Dev Tools"
      >
        <Wrench className="h-4 w-4" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              transition={{ duration: 0.2 }}
              className="fixed left-1/2 top-20 z-50 w-full max-w-md -translate-x-1/2 rounded-2xl border border-white/10 bg-black/90 p-4 shadow-2xl backdrop-blur-xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20">
                    <Wrench className="h-4 w-4 text-indigo-400" />
                  </div>
                  <h2 className="font-display text-lg font-bold">Dev Tools</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2">
                {menuItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    target={item.external ? "_blank" : undefined}
                    rel={item.external ? "noopener noreferrer" : undefined}
                    onClick={() => !item.external && setIsOpen(false)}
                    className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/5 p-3 transition-all hover:border-indigo-500/30 hover:bg-indigo-500/10"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/20">
                      <item.icon className="h-5 w-5 text-indigo-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    {item.external && (
                      <span className="text-xs text-muted-foreground">↗</span>
                    )}
                  </Link>
                ))}
              </div>

              <div className="mt-4 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-200/80">
                <p className="font-medium">⚠️ Техническая панель</p>
                <p className="mt-1 text-amber-200/60">
                  Доступ к диагностике и проверке точности прогнозов
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
