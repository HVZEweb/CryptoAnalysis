"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, HelpCircle, Info, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PredictionHistoryItem } from "@/types";
import {
  fetchAccuracyResults,
  mapAccuracyByHistoryKey,
  type AccuracyApiResult,
} from "@/lib/accuracy-client";
import { dedupeHistoryItems, formatPrice, historyDedupKey, TIMEFRAME_LABELS } from "@/lib/utils";

interface AccuracyPanelProps {
  history: PredictionHistoryItem[];
}

export function AccuracyPanel({ history }: AccuracyPanelProps) {
  const [resultMap, setResultMap] = useState<Map<string, AccuracyApiResult>>(new Map());
  const [items, setItems] = useState<PredictionHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAccuracy = useCallback(async () => {
    setLoading(true);
    setError(null);
    const source = dedupeHistoryItems(history);
    setItems(source);

    if (source.length === 0) {
      setResultMap(new Map());
      setLoading(false);
      return;
    }

    try {
      const { results, error: apiError } = await fetchAccuracyResults(source);
      setResultMap(mapAccuracyByHistoryKey(source, results));
      if (apiError) setError(apiError);
    } catch {
      setError("Не удалось загрузить оценку точности");
      setResultMap(new Map());
    } finally {
      setLoading(false);
    }
  }, [history]);

  useEffect(() => {
    loadAccuracy();
  }, [loadAccuracy]);

  if (items.length === 0 && history.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">
        История пуста — точность появится после прогнозов
      </div>
    );
  }

  const displayItems = items.length > 0 ? items : dedupeHistoryItems(history);
  const results = displayItems
    .map((h) => resultMap.get(historyDedupKey(h)))
    .filter(Boolean) as AccuracyApiResult[];

  const scored = results.filter((r) => (r.score ?? 0) > 0);
  const avgScore =
    scored.length > 0
      ? Math.round(scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length)
      : null;
  const correct = results.filter(
    (r) => r.timeframePhase === "completed" && r.isCorrect === true
  ).length;
  const evaluated = results.filter(
    (r) => r.timeframePhase === "completed" && r.isCorrect !== null
  ).length;
  const inProgress = results.filter((r) => r.timeframePhase === "in_progress").length;

  return (
    <div className="card-premium flex h-full min-h-[40vh] flex-col rounded-3xl p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Точность прогнозов</h3>
          <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {displayItems.length} прогноз(ов). Оценка по целевой цене, направлению, коридору и TP/SL.
            {avgScore != null && <> Средний балл: {avgScore}/100.</>}
            {evaluated > 0 && <> Точных: {correct}/{evaluated}.</>}
            {inProgress > 0 && <> В процессе: {inProgress}.</>}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="rounded-xl shrink-0"
          disabled={loading}
          onClick={loadAccuracy}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {error && <p className="text-sm text-amber-400">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Анализ свечей и целевых цен...</p>}

      {!loading && displayItems.length > 0 && results.length === 0 && !error && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Нет данных для отображения — нажмите «Обновить»
        </p>
      )}

      {displayItems.map((historyItem) => {
        const item = resultMap.get(historyDedupKey(historyItem));
        if (!item) {
          return (
            <div key={historyItem.id} className="rounded-xl bg-white/3 p-3 text-xs text-muted-foreground">
              {historyItem.symbol} · {TIMEFRAME_LABELS[historyItem.timeframe]} · {historyItem.direction}
              — ожидание оценки…
            </div>
          );
        }

        const Icon =
          item.label === "В процессе" || item.label === "На траектории" || item.label === "Уточняется"
            ? Clock
            : item.isCorrect === true || item.label === "Точно"
              ? CheckCircle2
              : item.isCorrect === false || item.label === "Мимо"
                ? XCircle
                : HelpCircle;
        const color =
          item.label === "В процессе" || item.label === "На траектории" || item.label === "Уточняется"
            ? "text-indigo-400"
            : item.isCorrect === true || item.label === "Точно"
              ? "text-emerald-400"
              : item.isCorrect === false || item.label === "Мимо"
                ? "text-red-400"
                : "text-amber-400";

        const predicted = item.predictedPrice ?? historyItem.priceForecast?.predictedPrice;

        return (
          <div key={historyItem.id} className="rounded-xl bg-white/3 p-3">
            <div className="flex items-center gap-3">
              <Icon className={`h-5 w-5 shrink-0 ${color}`} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">
                  {item.symbol} · {TIMEFRAME_LABELS[historyItem.timeframe] ?? ""} · {historyItem.direction}
                  {item.score != null && item.score > 0 && (
                    <span className="ml-2 text-indigo-300">{item.score}/100</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  ${formatPrice(item.priceAtPrediction || historyItem.priceAtPrediction || 0)}
                  {predicted ? <> → цель ${formatPrice(predicted)}</> : null}
                  {" · "}
                  факт ${item.currentPrice ? formatPrice(item.currentPrice) : "—"}
                  {item.priceErrorPct != null && item.priceErrorPct > 0 && (
                    <> (ошибка {item.priceErrorPct.toFixed(2)}%)</>
                  )}
                </p>
              </div>
              <span className={`shrink-0 text-xs font-medium ${color}`}>
                {item.label}
                {item.timeframePhase === "completed" && (
                  <span className="ml-1 text-[10px] text-muted-foreground">· итог</span>
                )}
              </span>
            </div>
            {item.details && item.details.length > 0 && (
              <ul className="mt-2 space-y-0.5 pl-8 text-[10px] text-muted-foreground">
                {item.details.map((d, j) => (
                  <li key={j}>{d}</li>
                ))}
              </ul>
            )}
            {item.explanation && !item.details?.length && (
              <p className="mt-2 pl-8 text-[11px] leading-relaxed text-muted-foreground">{item.explanation}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
