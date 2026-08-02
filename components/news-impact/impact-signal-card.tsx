"use client";

import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  ExternalLink,
  Link2,
  Minus,
  Zap,
} from "lucide-react";
import { DIRECTION_CONFIG, cn } from "@/lib/utils";
import type { NewsImpactSignal } from "@/lib/news-impact/types";

const STRENGTH_STYLES: Record<NewsImpactSignal["strength"], string> = {
  Low: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/20",
  Medium: "bg-amber-500/15 text-amber-200 ring-amber-500/25",
  High: "bg-orange-500/15 text-orange-200 ring-orange-500/25",
  Extreme: "bg-red-500/20 text-red-200 ring-red-500/30",
};

const URGENCY_STYLES: Record<NewsImpactSignal["urgency"], string> = {
  Immediate: "text-red-300 bg-red-500/15 ring-1 ring-red-500/25",
  Short: "text-amber-200 bg-amber-500/10 ring-1 ring-amber-500/20",
  Medium: "text-sky-200 bg-sky-500/10 ring-1 ring-sky-500/15",
};

const ACTION_STYLES: Record<NewsImpactSignal["recommendedAction"], string> = {
  "Long Futures": "text-emerald-300",
  Short: "text-red-300",
  Wait: "text-muted-foreground",
};

const IMPACT_ON_LABELS: Record<NewsImpactSignal["impactOnExisting"], string> = {
  confirms: "Подтверждает прогноз",
  contradicts: "Противоречит прогнозу",
  neutral: "Нейтрально к прогнозу",
  none: "Нет активного прогноза",
};

export function formatSectorHint(signal: NewsImpactSignal): string | null {
  if (!signal.sectorLabel) return null;
  const peers = (signal.affectedCoins ?? [])
    .filter((a) => a.coin !== signal.coin && a.weight < 1)
    .map((a) => a.coin);
  if (peers.length === 0) return `сектор ${signal.sectorLabel}`;
  return `и сектор ${signal.sectorLabel}`;
}

export function isHotImpactSignal(signal: NewsImpactSignal): boolean {
  return (
    !signal.isSecondary &&
    (signal.strength === "High" || signal.strength === "Extreme") &&
    signal.impactScore >= 65
  );
}

function directionBorder(signal: NewsImpactSignal): string {
  if (signal.direction === "LONG") return "border-l-emerald-500/70";
  if (signal.direction === "SHORT") return "border-l-red-500/70";
  return "border-l-zinc-500/40";
}

interface ImpactSignalCardProps {
  signal: NewsImpactSignal;
  selected?: boolean;
  hot?: boolean;
  onSelect?: () => void;
}

export function ImpactSignalCard({ signal, selected, hot, onSelect }: ImpactSignalCardProps) {
  const dir = DIRECTION_CONFIG[signal.direction];
  const sectorHint = formatSectorHint(signal);
  const DirectionIcon =
    signal.direction === "LONG"
      ? ArrowUpRight
      : signal.direction === "SHORT"
        ? ArrowDownRight
        : Minus;

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onSelect}
      className={cn(
        "w-full rounded-2xl border border-l-4 p-4 text-left transition-all",
        directionBorder(signal),
        hot && signal.direction === "LONG" && "ring-1 ring-emerald-500/30 bg-emerald-500/[0.06]",
        hot && signal.direction === "SHORT" && "ring-1 ring-red-500/30 bg-red-500/[0.06]",
        selected
          ? "border-indigo-500/40 bg-indigo-500/10 ring-1 ring-indigo-500/20"
          : "border-white/8 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.05]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-white/5 px-2 py-1 font-display text-sm font-bold">
            {signal.coin}
          </span>
          {sectorHint && (
            <span className="text-[10px] text-indigo-300/90">{sectorHint}</span>
          )}
          <span className={cn("flex items-center gap-1 text-sm font-semibold", dir.color)}>
            <DirectionIcon className="h-4 w-4" />
            {dir.label}
          </span>
          {hot && (
            <span className="rounded-md bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-200">
              HOT
            </span>
          )}
        </div>
        <div className="text-right">
          <p className="font-display text-xl font-bold leading-none">{signal.impactScore}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">impact</p>
          <p className="mt-0.5 text-[10px] font-mono text-indigo-300/90">{signal.confidence}% conf</p>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-sm text-foreground/90">{signal.reason}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-medium ring-1", STRENGTH_STYLES[signal.strength])}>
          {signal.strength}
        </span>
        <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-medium", URGENCY_STYLES[signal.urgency])}>
          {signal.urgency}
        </span>
        <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-medium", ACTION_STYLES[signal.recommendedAction])}>
          {signal.recommendedAction}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {signal.suggestedHoldTime}
        </span>
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3" />
          ~{signal.expectedMovePct}%
        </span>
        <span>{signal.source}</span>
      </div>
    </motion.button>
  );
}

interface ImpactDetailPanelProps {
  signal: NewsImpactSignal | null;
}

export function ImpactDetailPanel({ signal }: ImpactDetailPanelProps) {
  if (!signal) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
        <Zap className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">Выберите сигнал для деталей</p>
      </div>
    );
  }

  const dir = DIRECTION_CONFIG[signal.direction];
  const sectorHint = formatSectorHint(signal);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold">
            {signal.coin} · <span className={dir.color}>{dir.label}</span>
          </h3>
          {sectorHint && (
            <p className="mt-0.5 text-xs text-indigo-300/90">{sectorHint}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {new Date(signal.timestamp).toLocaleString("ru-RU")} · {signal.category}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="rounded-xl bg-indigo-500/15 px-3 py-2 text-center ring-1 ring-indigo-500/20">
            <p className="font-display text-2xl font-bold">{signal.impactScore}</p>
            <p className="text-[10px] uppercase text-muted-foreground">score</p>
          </div>
          <div className="rounded-xl bg-emerald-500/10 px-3 py-2 text-center ring-1 ring-emerald-500/20">
            <p className="font-display text-2xl font-bold">{signal.confidence}</p>
            <p className="text-[10px] uppercase text-muted-foreground">conf %</p>
          </div>
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-foreground/90">{signal.reason}</p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <DetailChip label="Сила" value={signal.strength} />
        <DetailChip label="Срочность" value={signal.urgency} />
        <DetailChip label="Действие" value={signal.recommendedAction} />
        <DetailChip label="Ход" value={`~${signal.expectedMovePct}%`} />
        <DetailChip label="Удержание" value={signal.suggestedHoldTime} />
        <DetailChip label="Метод" value={signal.analysisMethod} />
        {signal.mlScore != null && <DetailChip label="ML score" value={String(signal.mlScore)} />}
        {signal.regimeProxy && <DetailChip label="Regime" value={signal.regimeProxy} />}
      </div>

      {signal.affectedCoins && signal.affectedCoins.length > 1 && (
        <div className="mt-4 rounded-xl border border-white/5 bg-black/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">Затронутые монеты</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {signal.affectedCoins.map((a) => (
              <span
                key={a.coin}
                className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-mono text-indigo-200"
              >
                {a.coin} {Math.round(a.weight * 100)}%
              </span>
            ))}
          </div>
        </div>
      )}

      {(signal.newsContext || signal.marketContext) && (
        <div className="mt-4 rounded-xl border border-white/5 bg-black/20 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">News Context (30 мин до новости)</p>
          {signal.newsContext && <p className="text-xs text-foreground/85">{signal.newsContext}</p>}
          {signal.marketContext && (
            <p className="text-xs text-indigo-200/80">On-chain: {signal.marketContext}</p>
          )}
        </div>
      )}

      <div className="mt-4 rounded-xl border border-white/5 bg-black/20 p-3">
        <p className="text-xs font-medium text-muted-foreground">Связь с прогнозатором</p>
        <p className="mt-1 text-sm">{IMPACT_ON_LABELS[signal.impactOnExisting]}</p>
        {signal.relatedPredictionId && (
          <p className="mt-1 flex items-center gap-1 text-xs text-indigo-300">
            <Link2 className="h-3 w-3" />
            ID: {signal.relatedPredictionId}
          </p>
        )}
      </div>

      {signal.sourceUrl && (
        <a
          href={signal.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-200"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Открыть источник ({signal.source})
        </a>
      )}
    </div>
  );
}

function DetailChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs font-medium">{value}</p>
    </div>
  );
}
