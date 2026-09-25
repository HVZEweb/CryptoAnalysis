"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Shield, TrendingDown, TrendingUp } from "lucide-react";
import {
  CONFIDENCE_LABELS,
  DIRECTION_CONFIG,
  MARKET_LABELS,
  TIMEFRAME_LABELS,
  cn,
  formatPrice,
} from "@/lib/utils";
import { resolveTradeLevels } from "@/lib/trade-levels";
import { resolvePriceForecast, formatMovePct } from "@/lib/price-forecast";
import { TradeLevelsSummary } from "@/components/trade-levels-summary";
import { PredictionExplanationPanel } from "@/components/prediction-explanation";
import type { EnsembleBreakdown, PredictionResult } from "@/types";

interface PredictionCardProps {
  prediction: PredictionResult;
}

function ProbabilityRing({ value }: { value: number }) {
  const r = 40;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="relative h-[88px] w-[88px] shrink-0">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="url(#probGrad)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
        <defs>
          <linearGradient id="probGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#7c6cff" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-xl font-bold leading-none">{value}%</span>
        <span className="mt-0.5 text-[8px] uppercase tracking-wider text-muted-foreground">вероятн.</span>
      </div>
    </div>
  );
}

const VISIBLE_ITEMS = 2;

export function PredictionCard({ prediction }: PredictionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const dir = DIRECTION_CONFIG[prediction.direction];
  const glowClass =
    prediction.direction === "LONG"
      ? "glow-long"
      : prediction.direction === "SHORT"
        ? "glow-short"
        : "glow-sideways";

  const reasons = prediction.reasons ?? [];
  const risks = prediction.risks ?? [];
  const keyFactors = prediction.keyFeatures ?? prediction.keyFactors ?? [];

  const hasMore =
    reasons.length > VISIBLE_ITEMS ||
    risks.length > VISIBLE_ITEMS ||
    keyFactors.length > VISIBLE_ITEMS ||
    (prediction.recommendation?.length ?? 0) > 120;

  const visibleReasons = expanded ? reasons : reasons.slice(0, VISIBLE_ITEMS);
  const visibleRisks = expanded ? risks : risks.slice(0, VISIBLE_ITEMS);
  const visibleFactors = expanded ? keyFactors : keyFactors.slice(0, 3);
  const levels = resolveTradeLevels(prediction);
  const forecast = resolvePriceForecast(prediction);
  const displayPrice = levels.entry;
  const movePct = forecast.expectedMovePct;

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn("card-premium gradient-border overflow-hidden rounded-2xl", glowClass)}
    >
      {/* Header — одна строка */}
      <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-gradient-to-r from-indigo-500/8 to-transparent px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display truncate text-lg font-bold">
              {prediction.symbol}
              <span className="ml-1.5 font-normal text-muted-foreground">{prediction.coin}</span>
            </h2>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-bold ring-1 ring-white/10",
                dir.color,
                "bg-white/5"
              )}
            >
              {dir.emoji} {dir.label}
            </span>
            {prediction.ensembleScore !== undefined && (
              <EnsembleBadge score={prediction.ensembleScore} breakdown={prediction.ensembleBreakdown} />
            )}
            {prediction.modelConfidence && (
              <ModelConfidenceBadge confidence={prediction.modelConfidence} />
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Chip>{MARKET_LABELS[prediction.market] ?? prediction.market}</Chip>
            <Chip>{TIMEFRAME_LABELS[prediction.timeframe] ?? prediction.timeframe}</Chip>
            <Chip>${formatPrice(displayPrice)}</Chip>
          </div>
        </div>
      </div>

      {/* Целевая цена — главный блок прогноза */}
      <div className="border-b border-white/5 bg-gradient-to-br from-indigo-500/10 via-transparent to-cyan-500/5 px-4 py-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Целевая цена на конец таймфрейма</p>
        <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">
          <p className="font-display text-3xl font-bold tabular-nums tracking-tight">
            ${formatPrice(forecast.predictedPrice)}
          </p>
          <span
            className={cn(
              "mb-1 rounded-lg px-2 py-0.5 text-sm font-semibold tabular-nums",
              movePct >= 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
            )}
          >
            {formatMovePct(movePct)}
          </span>
        </div>
        <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Коридор (точный): </span>
            <span className="font-medium tabular-nums">
              ${formatPrice(forecast.confidenceBand.low)} — ${formatPrice(forecast.confidenceBand.high)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Min / Max за период: </span>
            <span className="font-medium tabular-nums">
              ${formatPrice(forecast.predictedLow)} — ${formatPrice(forecast.predictedHigh)}
            </span>
          </div>
        </div>
      </div>

      {prediction.explanation && (
        <div className="border-b border-white/5 px-4 py-3">
          <PredictionExplanationPanel explanation={prediction.explanation} compact />
        </div>
      )}

      {/* Метрики + быстрая сводка */}
      <div className="grid gap-3 px-4 py-3 lg:grid-cols-[auto_1fr_1.1fr] lg:items-center">
        <ProbabilityRing value={prediction.probability} />
        <div className="min-w-0 space-y-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Диапазон</p>
            <p className="font-display text-sm font-semibold tabular-nums">
              ${formatPrice(prediction.priceRange.low)} — ${formatPrice(prediction.priceRange.high)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1 text-emerald-400">
              <TrendingUp className="h-3 w-3" />
              {prediction.probabilityUp}%
            </span>
            <span className="flex items-center gap-1 text-red-400">
              <TrendingDown className="h-3 w-3" />
              {prediction.probabilityDown}%
            </span>
            <span className="text-muted-foreground">
              Уверенность:{" "}
              <span className="font-medium text-foreground">
                {CONFIDENCE_LABELS[prediction.confidence]}
              </span>
            </span>
          </div>
        </div>
        <TradeLevelsSummary prediction={prediction} />
      </div>

      {/* Причины / Риски — 2 колонки */}
      <div className="grid gap-2 border-t border-white/5 px-4 py-3 sm:grid-cols-2">
        <CompactList title="Причины" items={visibleReasons} accent="text-emerald-400" />
        <CompactList title="Риски" items={visibleRisks} accent="text-red-400" />
      </div>

      {/* Факторы + рекомендация */}
      <div className="space-y-2 border-t border-white/5 px-4 py-3">
        {visibleFactors.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {visibleFactors.map((f, i) => (
              <span
                key={i}
                className="rounded-md bg-indigo-500/10 px-2 py-0.5 text-[11px] text-indigo-200 ring-1 ring-indigo-500/15"
              >
                {f}
              </span>
            ))}
          </div>
        )}
        {prediction.refinementNotes && prediction.refinementNotes.length > 0 && (
          <div className="space-y-1">
            {prediction.refinementNotes.map((note, i) => (
              <p key={i} className="text-[11px] leading-snug text-amber-300/90">
                ⚙ {note}
              </p>
            ))}
          </div>
        )}
        <p className={cn("text-xs leading-relaxed text-foreground/85", !expanded && "line-clamp-2")}>
          <span className="font-medium text-indigo-300">Рекомендация: </span>
          {prediction.recommendation}
        </p>
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t border-white/5 py-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? "Свернуть" : "Показать полностью"}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      )}

      <p className="border-t border-white/5 px-4 py-2 text-center text-[10px] italic text-muted-foreground/50">
        {prediction.disclaimer}
      </p>
    </motion.article>
  );
}

function ModelConfidenceBadge({
  confidence,
}: {
  confidence: NonNullable<PredictionResult["modelConfidence"]>;
}) {
  const color =
    confidence.label === "High"
      ? "bg-cyan-500/15 text-cyan-300 ring-cyan-500/25"
      : confidence.label === "Medium"
        ? "bg-amber-500/15 text-amber-200 ring-amber-500/25"
        : "bg-red-500/15 text-red-300 ring-red-500/25";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-bold ring-1",
        color
      )}
      title={`Live model confidence · 30d accuracy ${(confidence.rollingAccuracy30d * 100).toFixed(0)}% · ${confidence.sampleCount} samples${confidence.driftAlert ? " · drift alert" : ""}`}
    >
      <Shield className="h-3 w-3 opacity-80" />
      <span className="text-[9px] uppercase tracking-wider opacity-70">Model</span>
      {confidence.score}
      {confidence.driftAlert && <span className="text-[9px] opacity-80">⚠</span>}
    </span>
  );
}

function EnsembleBadge({
  score,
  breakdown,
}: {
  score: number;
  breakdown?: EnsembleBreakdown;
}) {
  // score is the weighted edge 2p − 1; half of it is the lean away from 50% in percentage points.
  const pts = (score * 50).toFixed(1);
  const signed = score > 0 ? `+${pts}` : pts;
  const agreement = breakdown?.agreement;
  const mlNote = breakdown && !breakdown.mlAvailable ? " · у модели нет подтверждённого преимущества" : "";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-bold ring-1",
        score >= 0.04
          ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/25"
          : score <= -0.04
            ? "bg-red-500/15 text-red-300 ring-red-500/25"
            : "bg-indigo-500/15 text-indigo-200 ring-indigo-400/30"
      )}
      title={`Перевес ансамбля от 50% (модель + ИИ + правила)${agreement ? ` · ${agreement}` : ""}${mlNote}`}
    >
      <span className="text-[9px] uppercase tracking-wider opacity-70">Ens</span>
      {signed} п.п.
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-white/8">
      {children}
    </span>
  );
}

function CompactList({
  title,
  items,
  accent,
}: {
  title: string;
  items: string[];
  accent: string;
}) {
  return (
    <div>
      <p className={cn("text-[10px] font-medium uppercase tracking-wider", accent)}>{title}</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-xs leading-snug text-foreground/80 before:mr-1 before:text-muted-foreground before:content-['·']">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
