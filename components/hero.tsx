"use client";

import { motion } from "framer-motion";
import { Sparkles, Zap, Wrench } from "lucide-react";
import { MarketOverview } from "@/components/market-overview";
import { AccountBar } from "@/components/account-bar";
import { DevMenu } from "@/components/dev-menu";
import type { AuthUser, QuotaStatus } from "@/types";

interface HeroProps {
  user: AuthUser | null;
  quota: QuotaStatus | null;
  onLogin: () => void;
  onRegister: () => void;
  onLogout: () => void;
  onUpgrade: () => void;
}

export function Hero({ user, quota, onLogin, onRegister, onLogout, onUpgrade }: HeroProps) {
  return (
    <header className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
              <span className="gradient-text">AI Crypto Predictor</span>
            </h1>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Zap className="h-3 w-3 text-amber-400" />
              1 бесплатно · +2 после регистрации
            </p>
          </div>
        </div>
                <div className="flex items-center gap-2">
          <DevMenu />
          <AccountBar
            user={user}
            quota={quota}
            onLogin={onLogin}
            onRegister={onRegister}
            onLogout={onLogout}
            onUpgrade={onUpgrade}
          />
        </div>
      </motion.div>
      <MarketOverview />
    </header>
  );
}
