"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: string;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="card-premium gradient-border flex flex-1 min-h-[40vh] flex-col items-center justify-center rounded-3xl p-8 text-center"
    >
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.05] ring-1 ring-white/10">
        <Icon className="h-8 w-8 text-indigo-400 animate-float" />
      </div>
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground leading-relaxed">{description}</p>
      {action && (
        <p className="mt-4 rounded-full bg-indigo-500/10 px-4 py-1.5 text-xs text-indigo-300">{action}</p>
      )}
    </motion.div>
  );
}
