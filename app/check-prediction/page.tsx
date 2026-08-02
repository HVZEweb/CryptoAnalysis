"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { evaluatePredictionAccuracyFromPrices } from "@/lib/accuracy";
import { formatPrice } from "@/lib/utils";
import type { PredictionResult } from "@/types";

export default function CheckPredictionPage() {
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadLatestPrediction() {
      try {
        const res = await fetch("/api/predictions/latest");
        if (!res.ok) {
          throw new Error("Failed to load prediction");
        }
        const data = await res.json();
        setPrediction(data.prediction);

        // Получаем текущую цену
        const priceRes = await fetch(`/api/price?symbol=${data.prediction.symbol}`);
        if (priceRes.ok) {
          const priceData = await priceRes.json();
          setCurrentPrice(priceData.price);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    loadLatestPrediction();
    const interval = setInterval(loadLatestPrediction, 10000); // обновление каждые 10с
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Загрузка последнего прогноза...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-red-400">Ошибка: {error}</p>
          <p className="mt-2 text-sm text-muted-foreground">Сначала сделайте прогноз</p>
        </div>
      </div>
    );
  }

  if (!prediction || !currentPrice) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Нет данных</p>
      </div>
    );
  }

  const accuracy = evaluatePredictionAccuracyFromPrices(
    {
      direction: prediction.direction,
      priceAtPrediction: prediction.priceAtPrediction,
      timeframe: prediction.timeframe,
      createdAt: prediction.createdAt,
      priceRange: prediction.priceRange,
      priceForecast: prediction.priceForecast,
      tradeLevels: prediction.tradeLevels,
    },
    currentPrice
  );

  const createdAt = new Date(prediction.createdAt);
  const now = new Date();
  const elapsed = Math.floor((now.getTime() - createdAt.getTime()) / 1000);
  const elapsedMin = Math.floor(elapsed / 60);
  const elapsedSec = elapsed % 60;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">🔍 Проверка точности прогноза</h1>

      <div className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">Монета</p>
            <p className="text-xl font-bold">
              {prediction.symbol} {prediction.coin}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Таймфрейм</p>
            <p className="text-xl font-bold">{prediction.timeframe}</p>
          </div>
        </div>

        <div className="grid gap-4 border-t border-white/5 pt-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">Направление</p>
            <p className="text-lg font-bold">{prediction.direction}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Вероятность</p>
            <p className="text-lg font-bold">{prediction.probability}%</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Прошло времени</p>
            <p className="text-lg font-bold">
              {elapsedMin}м {elapsedSec}с
            </p>
          </div>
        </div>

        <div className="grid gap-4 border-t border-white/5 pt-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">Цена на момент прогноза</p>
            <p className="font-mono text-lg font-bold">${formatPrice(prediction.priceAtPrediction)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Прогноз цены (конец ТФ)</p>
            <p className="font-mono text-lg font-bold">${formatPrice(prediction.priceForecast?.predictedPrice ?? prediction.priceAtPrediction)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Текущая цена</p>
            <p className="font-mono text-lg font-bold text-cyan-400">${formatPrice(currentPrice)}</p>
          </div>
        </div>

        <div className="border-t border-white/5 pt-4">
          <p className="text-sm text-muted-foreground">Оценка точности</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Статус</p>
              <p
                className={
                  accuracy.isCorrect === true
                    ? "text-lg font-bold text-emerald-400"
                    : accuracy.isCorrect === false
                      ? "text-lg font-bold text-red-400"
                      : "text-lg font-bold text-yellow-400"
                }
              >
                {accuracy.label}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Score</p>
              <p className="text-lg font-bold">{accuracy.score}/100</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Ошибка цены</p>
              <p className="text-lg font-bold">{accuracy.priceErrorPct.toFixed(2)}%</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{accuracy.explanation}</p>
        </div>

        {accuracy.details && accuracy.details.length > 0 && (
          <div className="border-t border-white/5 pt-4">
            <p className="mb-2 text-sm font-medium">Детали оценки:</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {accuracy.details.map((detail, i) => (
                <li key={i}>• {detail}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-white/5 pt-4">
          <p className="text-xs text-muted-foreground">
            Создан: {createdAt.toLocaleString("ru-RU")} • Обновляется каждые 10 секунд
          </p>
        </div>
      </div>

      <div className="mt-4 text-center">
        <Link href="/" className="text-sm text-indigo-400 hover:text-indigo-300">
          ← Вернуться к главной
        </Link>
      </div>
    </div>
  );
}
