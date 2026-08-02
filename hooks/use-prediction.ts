"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiError, AnalysisSnapshot, PredictionFormData, PredictionHistoryItem, PredictionResult } from "@/types";
import type { PipelineStep } from "@/lib/progress";
import { generateId, dedupeHistoryItems, historyDedupKey } from "@/lib/utils";

const HISTORY_KEY = "crypto-ai-predictor-history";
const MAX_HISTORY = 50;

export function usePredictionHistory(isLoggedIn = false) {
  const [history, setHistory] = useState<PredictionHistoryItem[]>([]);

  const loadLocal = useCallback(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) setHistory(JSON.parse(stored) as PredictionHistoryItem[]);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    loadLocal();
  }, [loadLocal]);

  useEffect(() => {
    if (!isLoggedIn) return;
    fetch(`/api/predictions?limit=${MAX_HISTORY}`)
      .then((r) => r.json())
      .then((data: { predictions: PredictionResult[] }) => {
        const serverItems: PredictionHistoryItem[] = (data.predictions ?? []).map((p, i) => ({
          ...p,
          id: `srv-${p.createdAt}-${i}`,
        }));
        setHistory((prev) => {
          const merged = dedupeHistoryItems([...serverItems, ...prev]);
          const updated = merged.slice(0, MAX_HISTORY);
          localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
          return updated;
        });
      })
      .catch(() => undefined);
  }, [isLoggedIn]);

  const saveToHistory = useCallback((prediction: PredictionResult) => {
    const item: PredictionHistoryItem = { ...prediction, id: generateId() };
    setHistory((prev) => {
      const key = historyDedupKey(item);
      const withoutDup = prev.filter((p) => historyDedupKey(p) !== key);
      const updated = [item, ...withoutDup].slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearHistory = useCallback(async () => {
    if (isLoggedIn) {
      try {
        await fetch("/api/predictions", { method: "DELETE" });
      } catch {
        // local clear still proceeds
      }
    }
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  }, [isLoggedIn]);

  return { history, saveToHistory, clearHistory };
}

interface StreamState {
  loading: boolean;
  error: ApiError | null;
  result: PredictionResult | null;
  analysis: AnalysisSnapshot | null;
  progress: number;
  step: PipelineStep | null;
  stepMessage: string;
}

export function usePrediction() {
  const [state, setState] = useState<StreamState>({
    loading: false,
    error: null,
    result: null,
    analysis: null,
    progress: 0,
    step: null,
    stepMessage: "",
  });

  const predict = useCallback(async (formData: PredictionFormData) => {
    setState({
      loading: true,
      error: null,
      result: null,
      analysis: null,
      progress: 0,
      step: null,
      stepMessage: "Запуск анализа...",
    });

    const parseSsePayload = (raw: string) => {
      try {
        return JSON.parse(raw) as {
          type: string;
          step?: PipelineStep;
          progress?: number;
          message?: string;
          prediction?: PredictionResult;
          error?: ApiError;
        };
      } catch {
        return null;
      }
    };

    const consumeSseText = (text: string): PredictionResult | null => {
      let prediction: PredictionResult | null = null;
      const chunks = text.split("\n\n");

      for (const chunk of chunks) {
        const line = chunk.trim();
        if (!line.startsWith("data: ")) continue;
        const payload = parseSsePayload(line.slice(6));
        if (!payload) continue;

        if (payload.type === "progress") {
          setState((s) => ({
            ...s,
            progress: payload.progress ?? s.progress,
            step: payload.step ?? s.step,
            stepMessage: payload.message ?? s.stepMessage,
          }));
        }

        if (payload.type === "result" && payload.prediction) {
          prediction = payload.prediction;
          setState({
            loading: false,
            error: null,
            result: payload.prediction,
            analysis: payload.prediction.analysis ?? null,
            progress: 100,
            step: "done",
            stepMessage: "Готово",
          });
        }

        if (payload.type === "error" && payload.error) {
          setState((s) => ({ ...s, loading: false, error: payload.error! }));
          return null;
        }

        if (payload.step === "error" && payload.message) {
          setState((s) => ({
            ...s,
            loading: false,
            error: { code: "UNKNOWN", message: payload.message! },
          }));
          return null;
        }
      }

      return prediction;
    };

    try {
      const response = await fetch("/api/predict/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const text = await response.text();
        const fromSse = consumeSseText(text);
        if (fromSse === null && text.includes('"type":"error"')) return null;

        if (response.status === 402) {
          setState((s) => ({
            ...s,
            loading: false,
            error: {
              code: "QUOTA_EXCEEDED",
              message: "Лимит бесплатных прогнозов исчерпан. Зарегистрируйтесь или оформите подписку.",
            },
          }));
          return null;
        }
        if (response.status === 429) {
          setState((s) => ({
            ...s,
            loading: false,
            error: { code: "RATE_LIMIT", message: "Превышен лимит запросов. Подождите минуту." },
          }));
          return null;
        }
        if (response.status === 405) {
          setState((s) => ({
            ...s,
            loading: false,
            error: {
              code: "UNKNOWN",
              message:
                "405 Method Not Allowed — API вызван неверным методом. Откройте сайт на http://localhost:3000 (npm run dev), не через localhost/crypto.",
            },
          }));
          return null;
        }

        const generic =
          response.status === 402
            ? "Лимит бесплатных прогнозов исчерпан. Зарегистрируйтесь или войдите."
            : `Не удалось запустить прогноз (HTTP ${response.status}). Проверьте http://localhost:3000/api/status`;

        setState((s) => ({
          ...s,
          loading: false,
          error: { code: "UNKNOWN", message: generic },
        }));
        return null;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Stream unavailable");

      const decoder = new TextDecoder();
      let buffer = "";
      let prediction: PredictionResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          const payload = parseSsePayload(line.slice(6));
          if (!payload) continue;

          if (payload.type === "progress") {
            setState((s) => ({
              ...s,
              progress: payload.progress ?? s.progress,
              step: payload.step ?? s.step,
              stepMessage: payload.message ?? s.stepMessage,
            }));
          }

          if (payload.type === "result" && payload.prediction) {
            prediction = payload.prediction;
            setState({
              loading: false,
              error: null,
              result: payload.prediction,
              analysis: payload.prediction.analysis ?? null,
              progress: 100,
              step: "done",
              stepMessage: "Готово",
            });
          }

          if (payload.type === "error" && payload.error) {
            setState((s) => ({ ...s, loading: false, error: payload.error! }));
            return null;
          }
        }
      }

      if (!prediction) {
        setState((s) => ({
          ...s,
          loading: false,
          error: {
            code: "INVALID_RESPONSE",
            message: "Прогноз не получен. Модель могла не успеть ответить — попробуйте ещё раз.",
          },
        }));
      }

      return prediction;
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      const error: ApiError = !navigator.onLine
        ? { code: "NO_INTERNET", message: "Отсутствует подключение к интернету." }
        : {
            code: "UNKNOWN",
            message: message || "Произошла ошибка при генерации прогноза.",
          };

      setState((s) => ({ ...s, loading: false, error }));
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      loading: false,
      error: null,
      result: null,
      analysis: null,
      progress: 0,
      step: null,
      stepMessage: "",
    });
  }, []);

  return { ...state, predict, reset };
}
