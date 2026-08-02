"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { BookMarked } from "lucide-react";
import { AlphaRegistryDashboard } from "@/components/alpha-registry/alpha-registry-dashboard";

export default function AlphaRegistryPage() {
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
              <BookMarked className="h-7 w-7 text-indigo-400" />
              Alpha Registry
            </motion.h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Общий реестр гипотез · MSB · EIL · только validated → бот
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/continuous-research" className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10">
              MSB
            </Link>
            <Link href="/execution-lab" className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10">
              EIL
            </Link>
            <Link href="/" className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10">
              ← Главная
            </Link>
          </div>
        </div>
        <AlphaRegistryDashboard />
      </div>
    </div>
  );
}
