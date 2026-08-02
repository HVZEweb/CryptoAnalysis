"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Newspaper, Radar } from "lucide-react";
import { NewsImpactPanel } from "@/components/news-impact/NewsImpactPanel";

export default function NewsImpactPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-black to-zinc-950 text-foreground">
      <div className="mesh-bg pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 text-2xl font-bold"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-red-500/20 ring-1 ring-amber-500/20">
                <Radar className="h-5 w-5 text-amber-400" />
              </div>
              News Impact Detector
            </motion.h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Newspaper className="h-3.5 w-3.5" />
              Мониторинг новостей каждую минуту · мгновенный прогноз влияния на цену
            </p>
          </div>
          <Link
            href="/"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
          >
            ← Главная
          </Link>
        </div>

        <NewsImpactPanel />
      </div>
    </div>
  );
}
