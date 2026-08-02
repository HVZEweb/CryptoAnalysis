"use client";

import { useState } from "react";
import { ChevronDown, Gauge, Layers, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import type { PredictionExplanation } from "@/types";
import { cn } from "@/lib/utils";

const SOURCE_LABELS: Record<PredictionExplanation["topDrivers"][number]["source"], string> = {
  technical: "Техника",
  regime: "Режим",
  onchain: "On-chain",
  sentiment: "Сентимент",
  ensemble: "Ensemble",
};

const BIAS_STYLES: Record<PredictionExplanation["topDrivers"][number]["bias"], string> = {
  bullish: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
  bearish: "text-red-400 bg-red-500/10 ring-red-500/20",
  neutral: "text-muted-foreground bg-white/5 ring-white/10",
};

interface PredictionExplanationPanelProps {
  explanation: PredictionExplanation;
  compact?: boolean;
  className?: string;
}

export function PredictionExplanationPanel({
  explanation,
  compact = false,
  className,
}: PredictionExplanationPanelProps) {
  const [techOpen, setTechOpen] = useState(false);

  return (
    <div
      className={cn(
        "rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/8 via-transparent to-cyan-500/5",
        compact ? "p-3" : "p-4",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-indigo-300">
            Почему такой прогноз
          </p>
          <p className={cn("mt-1.5 leading-relaxed text-foreground/90", compact ? "text-xs" : "text-sm")}>
            {explanation.summary}
          </p>
        </div>
      </div>

      {explanation.topDrivers.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <Gauge className="h-3 w-3" />
            Главные драйверы
          </p>
          <ul className="space-y-1.5">
            {explanation.topDrivers.map((d, i) => (
              <li
                key={`${d.label}-${i}`}
                className="flex flex-wrap items-start gap-2 rounded-lg bg-black/20 px-2.5 py-2 text-xs"
              >
                <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1", BIAS_STYLES[d.bias])}>
                  {SOURCE_LABELS[d.source]}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">{d.label}</span>
                  <span className="text-muted-foreground"> — {d.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 rounded-lg bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/5">
        <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-indigo-200/80">
          <Layers className="h-3 w-3" />
          Решение Ensemble
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-foreground/85">{explanation.ensembleRationale}</p>
        {explanation.ensembleVotes.length > 0 && (
          <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
            {explanation.ensembleVotes.map((v) => (
              <div key={v.component} className="rounded-md bg-black/25 px-2 py-1.5 text-[11px]">
                <p className="font-medium text-foreground">{v.component}</p>
                <p className="text-muted-foreground">
                  {v.direction} · вес {v.weight}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground/80">{v.note}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {explanation.strengths.length > 0 && (
          <StrengthWeaknessList
            title="Сильные стороны"
            items={explanation.strengths}
            icon={ThumbsUp}
            accent="text-emerald-400"
          />
        )}
        {explanation.weaknesses.length > 0 && (
          <StrengthWeaknessList
            title="Слабые стороны / риски"
            items={explanation.weaknesses}
            icon={ThumbsDown}
            accent="text-amber-400"
          />
        )}
      </div>

      {!compact && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setTechOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span>Техническая глубина</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", techOpen && "rotate-180")} />
          </button>
          {techOpen && (
            <p className="mt-2 rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {explanation.technicalDepth}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StrengthWeaknessList({
  title,
  items,
  icon: Icon,
  accent,
}: {
  title: string;
  items: string[];
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2 ring-1 ring-white/5">
      <p className={cn("flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider", accent)}>
        <Icon className="h-3 w-3" />
        {title}
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-[11px] leading-snug text-foreground/80 before:mr-1 before:text-muted-foreground before:content-['·']">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
