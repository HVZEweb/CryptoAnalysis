"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wrench, X, FlaskConical, LineChart, Radar, Users } from "lucide-react";
import Link from "next/link";

export function DevMenu() {
  const [isOpen, setIsOpen] = useState(false);

  const menuItems = [
    {
      href: "/admin",
      icon: Users,
      label: "Пользователи",
      description: "Роли, доступ и лимиты прогнозов",
    },
    {
      href: "/news-impact",
      icon: Radar,
      label: "Новости",
      description: "Мониторинг новостей и их влияния на цену",
    },
    {
      href: "/backtest",
      icon: LineChart,
      label: "Бэктест и стратегии",
      description: "Проверка моделей на истории, лаборатория стратегий, мониторинг",
    },
    {
      href: "/check-prediction",
      icon: FlaskConical,
      label: "Проверка точности",
      description: "Оценка последнего прогноза",
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:border-indigo-500/30 hover:bg-indigo-500/10 hover:text-indigo-400"
        title="Администрирование"
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
                  <h2 className="font-display text-lg font-bold">Администрирование</h2>
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
                    onClick={() => setIsOpen(false)}
                    className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/5 p-3 transition-all hover:border-indigo-500/30 hover:bg-indigo-500/10"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/20">
                      <item.icon className="h-5 w-5 text-indigo-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
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
