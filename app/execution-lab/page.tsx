"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Microscope, Play, Database, FlaskConical, FileText, AlertTriangle } from "lucide-react";

const PATTERNS = [
  "level_defense",
  "liquidity_pull",
  "fake_liquidity",
  "aggressive_absorption",
  "spread_hold",
  "spread_widen",
  "twap_signature",
  "vwap_signature",
  "iceberg_refill",
  "large_footprint",
];

const STEPS = [
  {
    icon: Database,
    title: "1. Сбор данных",
    cmd: "npm run eil:collect",
    wait: "L2, trades, ticker, funding, OI → Parquet. Оставьте работать 24/7.",
  },
  {
    icon: Play,
    title: "2. Один паттерн",
    cmd: "npm run eil:study -- --pattern twap_signature",
    wait: "~2 мин. Один цикл = один паттерн. Параметры не меняем.",
  },
  {
    icon: FlaskConical,
    title: "3. Полный скан (редко)",
    cmd: "npm run eil:scan",
    wait: "Все 20 паттернов. Только после накопления истории.",
  },
  {
    icon: FileText,
    title: "4. Отчёты",
    cmd: "execution_intelligence_lab/results/",
    wait: "execution_alpha_candidate.md или execution_no_edge.md",
  },
];

export default function ExecutionLabPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-black to-zinc-950 text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 text-2xl font-bold"
            >
              <Microscope className="h-7 w-7 text-amber-400" />
              Execution Intelligence Lab
            </motion.h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Исследование исполнения крупных ордеров — не торговый бот
            </p>
          </div>
          <Link href="/" className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10">
            ← Главная
          </Link>
        </div>

        <div className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium text-amber-200">Независимый проект</p>
          <p className="mt-1 text-muted-foreground">
            Не изменяет Unified Trading Bot и Microstructure Lab. Стратегии в бота не добавляются автоматически.
          </p>
        </div>

        <div className="mb-6 rounded-2xl border border-white/10 bg-black/40 p-5">
          <h2 className="font-semibold">Экосистема</h2>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-black/60 p-4 text-xs text-muted-foreground">
{`Execution Intelligence Lab → Microstructure Lab → Research Validation
→ Alpha Proposal → Manual Review → Unified Trading Bot`}
          </pre>
        </div>

        <div className="space-y-4">
          {STEPS.map((s) => (
            <div key={s.title} className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center gap-3">
                <s.icon className="h-5 w-5 text-amber-400" />
                <p className="font-medium">{s.title}</p>
              </div>
              <code className="mt-2 block rounded-lg bg-white/5 px-3 py-2 text-xs">{s.cmd}</code>
              <p className="mt-2 text-sm text-muted-foreground">{s.wait}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-5">
          <h3 className="font-semibold">Примеры паттернов</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {PATTERNS.map((p) => (
              <span key={p} className="rounded-lg bg-white/10 px-2 py-1 font-mono text-xs">
                {p}
              </span>
            ))}
            <span className="rounded-lg px-2 py-1 text-xs text-muted-foreground">+10 ещё</span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Полный список: <code>python main.py study --list</code> в папке execution_intelligence_lab
          </p>
        </div>

        <div className="mt-6 flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-muted-foreground">
            События определяются квантилями распределения (q99, q95, …) — без фиксированных порогов. Отклонённые
            гипотезы не улучшаются и не подгоняются.
          </p>
        </div>
      </div>
    </div>
  );
}
