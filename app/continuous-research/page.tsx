"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { FlaskConical } from "lucide-react";
import { ContinuousResearchDashboard } from "@/components/microstructure/continuous-research-dashboard";

export default function ContinuousResearchPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-black to-zinc-950 text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 text-2xl font-bold"
            >
              <FlaskConical className="h-7 w-7 text-cyan-400" />
              Microstructure — Continuous Research
            </motion.h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ежедневно: сбор и проверка · Еженедельно: 8 гипотез · Только накопленные данные
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/maintenance"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
            >
              Legacy Maintenance
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
            >
              ← Главная
            </Link>
          </div>
        </div>

        <ContinuousResearchDashboard />
      </div>
    </div>
  );
}
