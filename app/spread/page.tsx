"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Radio } from "lucide-react";
import { TradingDashboard } from "@/components/spread/trading-dashboard";
import { TradingTabs, type TradingTab } from "@/components/spread/trading-tabs";
import { useState } from "react";

export default function SpreadPage() {
  const [activeTab, setActiveTab] = useState<TradingTab>("hft");

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
              <Radio className="h-7 w-7 text-violet-400" />
              OKX Futures Trading Bot
            </motion.h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Единый алгоритмический движок · HFT · Quant · AI · Meta Strategy
            </p>
          </div>
          <Link
            href="/"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
          >
            ← Главная
          </Link>
        </div>

        <TradingTabs active={activeTab} onChange={setActiveTab} />
        <TradingDashboard tab={activeTab} />
      </div>
    </div>
  );
}
