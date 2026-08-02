"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AnalysisSnapshot, EnsembleBreakdown, PredictionResult } from "@/types";
import { TradeLevelsSummary } from "@/components/trade-levels-summary";
import { PredictionExplanationPanel } from "@/components/prediction-explanation";
import { resolveTradeLevels } from "@/lib/trade-levels";
import { cn, formatNumber, formatPrice } from "@/lib/utils";

interface AnalysisPanelProps {
  analysis: AnalysisSnapshot | null;
  prediction?: PredictionResult | null;
}

export function AnalysisPanel({ analysis, prediction }: AnalysisPanelProps) {
  if (!analysis || !prediction) {
    return (
      <div className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">
        Данные анализа появятся после генерации прогноза
      </div>
    );
  }

  const levels = resolveTradeLevels(prediction);
  const primary = analysis.indicators[analysis.primaryTimeframe] ?? Object.values(analysis.indicators)[0];
  const breakdown = prediction.ensembleBreakdown;

  return (
    <div className="card-premium flex h-full min-h-[40vh] flex-col overflow-y-auto rounded-3xl p-5">
      <h3 className="font-display text-lg font-semibold">Прозрачность анализа</h3>
      <p className="text-xs text-muted-foreground">
        Данные, переданные в AI ({analysis.primaryTimeframe})
      </p>

      <div className="mt-4 space-y-3">
        {prediction.explanation && (
          <PredictionExplanationPanel explanation={prediction.explanation} />
        )}

        <TradeLevelsSummary prediction={prediction} className="bg-white/[0.02]" />

        {breakdown && <EnsembleBreakdownSection breakdown={breakdown} />}

        {analysis.marketRegime && (
          <Section title="Market Regime">
            <Row label="Режим" value={analysis.marketRegime.regime} />
            <Row label="Уверенность" value={`${analysis.marketRegime.confidence}%`} />
            <Row label="Bias score" value={analysis.marketRegime.score.toFixed(2)} />
            {analysis.marketRegime.signals.slice(0, 3).map((s, i) => (
              <p key={i} className="text-[11px] text-muted-foreground">
                · {s}
              </p>
            ))}
          </Section>
        )}

        {analysis.onChainFlow && prediction.market === "Futures" && (
          <Section title="On-chain / Order Flow">
            <Row
              label="Funding"
              value={`${analysis.onChainFlow.fundingOi.fundingRate.toFixed(6)} (${analysis.onChainFlow.fundingOi.fundingTrend})`}
            />
            <Row
              label="OI 24h"
              value={`${formatNumber(analysis.onChainFlow.fundingOi.openInterest)} (${analysis.onChainFlow.fundingOi.openInterestChange24hPct.toFixed(2)}%)`}
            />
            <Row
              label="CVD"
              value={`${analysis.onChainFlow.orderFlow.cvd.toFixed(3)} (${analysis.onChainFlow.orderFlow.cvdTrend})`}
            />
            <Row
              label="Delta"
              value={analysis.onChainFlow.orderFlow.deltaImbalance.toFixed(3)}
            />
            <Row
              label="Taker Buy %"
              value={`${(analysis.onChainFlow.orderFlow.takerBuyRatio * 100).toFixed(1)}%`}
            />
            {analysis.onChainFlow.liquidations.nearestLongLiq && (
              <Row
                label="Long Liq"
                value={`$${formatPrice(analysis.onChainFlow.liquidations.nearestLongLiq)}`}
              />
            )}
            {analysis.onChainFlow.liquidations.nearestShortLiq && (
              <Row
                label="Short Liq"
                value={`$${formatPrice(analysis.onChainFlow.liquidations.nearestShortLiq)}`}
              />
            )}
            <Row label="Источник liq" value={analysis.onChainFlow.liquidations.source} />
          </Section>
        )}

        <Section title="Рынок">
          <Row label="Цена (вход)" value={`$${formatPrice(levels.entry)}`} />
          <Row label="24h" value={`${analysis.marketData.priceChangePercent24h.toFixed(2)}%`} />
          <Row label="Объём USDT" value={formatNumber(analysis.marketData.quoteVolume)} />
          {analysis.marketData.fundingRate !== undefined && (
            <Row label="Funding Rate" value={analysis.marketData.fundingRate.toFixed(6)} />
          )}
        </Section>

        {primary && (
          <Section title="Индикаторы">
            <Row label="RSI" value={primary.rsi.toFixed(2)} />
            <Row label="MACD" value={primary.macd.macd.toFixed(4)} />
            <Row label="EMA 20/50" value={`${primary.ema20.toFixed(2)} / ${primary.ema50.toFixed(2)}`} />
            <Row label="ADX" value={primary.adx.toFixed(2)} />
            <Row label="ATR" value={primary.atr.toFixed(4)} />
            <Row label="SuperTrend" value={primary.superTrend.direction} />
          </Section>
        )}

        <Section title="Структура">
          <Row label="Тренд" value={analysis.marketStructure.trend} />
          <Row label="Объём" value={analysis.volumeAnalysis.volumeTrend} />
          <Row label="Поддержка" value={`$${formatPrice(analysis.levels.nearestSupport)}`} />
          <Row label="Сопротивление" value={`$${formatPrice(analysis.levels.nearestResistance)}`} />
          <Row label="SL (прогноз)" value={`$${formatPrice(levels.sl)}`} />
          <Row label="TP (прогноз)" value={`$${formatPrice(levels.tp)}`} />
        </Section>

        <Section title="Сентимент">
          <Row label="Fear & Greed" value={`${analysis.fearGreed.value} (${analysis.fearGreed.classification})`} />
          <Row label="BTC Dominance" value={`${analysis.btcDominance.dominance.toFixed(2)}%`} />
          <Row label="Новости" value={analysis.news.summary} />
          {analysis.news.sentimentSource && (
            <Row label="Sentiment engine" value={analysis.news.sentimentSource} />
          )}
        </Section>

        <Section title="Новости">
          {analysis.news.items.slice(0, 4).map((item, i) => (
            <p key={i} className="text-xs text-muted-foreground border-b border-border/50 py-2 last:border-0">
              {item.title}
            </p>
          ))}
        </Section>
      </div>
    </div>
  );
}

function EnsembleBreakdownSection({ breakdown }: { breakdown: EnsembleBreakdown }) {
  const [open, setOpen] = useState(false);
  const scorePct = (breakdown.ensembleScore * 100).toFixed(1);
  const w = breakdown.effectiveWeights;
  const mlScore = breakdown.mlAvailable
    ? breakdown.ml.direction === "LONG"
      ? breakdown.ml.probability / 100
      : breakdown.ml.direction === "SHORT"
        ? -breakdown.ml.probability / 100
        : 0
    : 0;

  return (
    <div className="rounded-xl bg-indigo-500/5 ring-1 ring-indigo-500/15">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-indigo-300">Ensemble Breakdown</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Score {scorePct}% · {breakdown.finalDirection} {breakdown.finalProbability}% ·{" "}
            {breakdown.agreement}
            {!breakdown.mlAvailable && " · ML недоступен"}
          </p>
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-2 border-t border-indigo-500/10 px-3 py-2.5 text-xs">
          <Row
            label="Веса (номинал)"
            value={`LLM ${(breakdown.weights.llm * 100).toFixed(0)}% · ML ${(breakdown.weights.ml * 100).toFixed(0)}% · Rules ${(breakdown.weights.rules * 100).toFixed(0)}%`}
          />
          <Row
            label="Веса (факт)"
            value={`LLM ${(w.llm * 100).toFixed(0)}% · ML ${(w.ml * 100).toFixed(0)}% · Rules ${(w.rules * 100).toFixed(0)}%`}
          />
          <VoteRow
            label="LLM"
            direction={breakdown.llm.direction}
            probability={breakdown.llm.probability}
            score={breakdown.llm.score}
          />
          <VoteRow
            label={`ML (${breakdown.ml.model})`}
            direction={breakdown.ml.direction}
            probability={breakdown.ml.probability}
            score={mlScore}
            muted={!breakdown.mlAvailable}
            extra={breakdown.ml.fallbackReason ? `fallback: ${breakdown.ml.fallbackReason}` : undefined}
          />
          <Row label="Rules (agg.)" value={`score ${(breakdown.rulesAggregateScore * 100).toFixed(1)}%`} />
          {breakdown.rules.length > 0 && (
            <ul className="ml-1 space-y-0.5 text-[11px] text-muted-foreground">
              {breakdown.rules.map((r, i) => (
                <li key={i}>
                  · {r.reason} → {r.direction} {r.probability}%
                </li>
              ))}
            </ul>
          )}
          {breakdown.mlError && (
            <p className="text-[11px] text-amber-300/90">ML note: {breakdown.mlError}</p>
          )}
        </div>
      )}
    </div>
  );
}

function VoteRow({
  label,
  direction,
  probability,
  score,
  muted,
  extra,
}: {
  label: string;
  direction: string;
  probability: number;
  score: number;
  muted?: boolean;
  extra?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", muted && "opacity-50")}>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-right font-medium">
          {direction} {probability}% · score {(score * 100).toFixed(1)}%
        </span>
      </div>
      {extra && <span className="text-[10px] text-muted-foreground">{extra}</span>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/3 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-indigo-300">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
