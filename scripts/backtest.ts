/**
 * Бэктест системы прогнозирования
 * 
 * Тестирует точность прогнозов на исторических данных
 * Запуск: npx tsx scripts/backtest.ts [symbol] [days] [model]
 * Пример: npx tsx scripts/backtest.ts BTC 30 kr/deepseek-3.2
 */

import { resolveCoinBySymbol } from "@/lib/coins";
import { evaluatePredictionAccuracyFromPrices } from "@/lib/accuracy";
import { runPredictionPipeline } from "@/services/prediction";
import type { Coin, MarketType, Timeframe } from "@/types";

interface BacktestResult {
  timestamp: number;
  prediction: {
    direction: string;
    probability: number;
    predictedPrice: number;
    priceAtPrediction: number;
  };
  actual: {
    price: number;
    percentChange: number;
  };
  accuracy: {
    score: number;
    label: string;
    priceErrorPct: number;
    isCorrect: boolean | null;
  };
}

interface BacktestStats {
  totalPredictions: number;
  accurateCount: number;
  partialCount: number;
  missedCount: number;
  winRate: number;
  avgScore: number;
  avgPriceError: number;
  byDirection: {
    LONG: { count: number; winRate: number; avgScore: number };
    SHORT: { count: number; winRate: number; avgScore: number };
    SIDEWAYS: { count: number; winRate: number; avgScore: number };
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateStats(results: BacktestResult[]): BacktestStats {
  const completed = results.filter((r) => r.accuracy.isCorrect !== null);
  const accurateCount = completed.filter((r) => r.accuracy.score >= 72).length;
  const partialCount = completed.filter(
    (r) => r.accuracy.score >= 48 && r.accuracy.score < 72
  ).length;
  const missedCount = completed.filter((r) => r.accuracy.score < 48).length;

  const byDirection = {
    LONG: { count: 0, winRate: 0, avgScore: 0 },
    SHORT: { count: 0, winRate: 0, avgScore: 0 },
    SIDEWAYS: { count: 0, winRate: 0, avgScore: 0 },
  };

  for (const dir of ["LONG", "SHORT", "SIDEWAYS"] as const) {
    const dirResults = completed.filter((r) => r.prediction.direction === dir);
    if (dirResults.length > 0) {
      byDirection[dir].count = dirResults.length;
      byDirection[dir].winRate =
        dirResults.filter((r) => r.accuracy.score >= 72).length / dirResults.length;
      byDirection[dir].avgScore =
        dirResults.reduce((sum, r) => sum + r.accuracy.score, 0) / dirResults.length;
    }
  }

  return {
    totalPredictions: results.length,
    accurateCount,
    partialCount,
    missedCount,
    winRate: completed.length > 0 ? accurateCount / completed.length : 0,
    avgScore: completed.reduce((sum, r) => sum + r.accuracy.score, 0) / completed.length,
    avgPriceError:
      completed.reduce((sum, r) => sum + r.accuracy.priceErrorPct, 0) / completed.length,
    byDirection,
  };
}

async function runBacktest(
  coin: Coin,
  market: MarketType,
  timeframe: Timeframe,
  daysBack: number,
  modelOverride?: string
): Promise<BacktestResult[]> {
  console.log(`\n🔄 Запуск бэктеста: ${coin.symbol} ${market} ${timeframe}`);
  console.log(`📅 Период: последние ${daysBack} дней`);
  console.log(`🤖 Модель: ${modelOverride || "default"}\n`);

  // В реальном бэктесте здесь должна быть загрузка исторических данных
  // Для MVP делаем упрощенную версию - прогоняем текущее состояние
  
  const results: BacktestResult[] = [];
  
  console.log("⚠️  DEMO MODE: Бэктест на исторических данных требует API Binance с историей");
  console.log("Для полноценного теста нужно:");
  console.log("1. Загрузить исторические свечи за период");
  console.log("2. Прогнать prediction pipeline на каждом срезе");
  console.log("3. Сравнить с фактом через timeframe\n");
  
  console.log("Запускаю демо-прогноз на текущих данных...\n");

  try {
    const prediction = await runPredictionPipeline(
      coin,
      market,
      timeframe,
      (event) => {
        process.stdout.write(`\r${event.step}: ${event.message.slice(0, 60)}...`);
      },
      modelOverride
    );

    console.log("\n\n✅ Прогноз получен");
    console.log(`Направление: ${prediction.direction}`);
    console.log(`Вероятность: ${prediction.probability}%`);
    console.log(`Прогноз цены: $${(prediction.priceForecast?.predictedPrice ?? prediction.priceAtPrediction).toFixed(2)}`);
    console.log(`Текущая цена: $${prediction.priceAtPrediction.toFixed(2)}\n`);

    // Для демо используем текущую цену как "факт"
    const demoActual = prediction.priceAtPrediction * 1.01; // +1% для примера
    
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
      demoActual
    );

    results.push({
      timestamp: Date.now(),
      prediction: {
        direction: prediction.direction,
        probability: prediction.probability,
        predictedPrice: prediction.priceForecast?.predictedPrice ?? prediction.priceAtPrediction,
        priceAtPrediction: prediction.priceAtPrediction,
      },
      actual: {
        price: demoActual,
        percentChange: ((demoActual - prediction.priceAtPrediction) / prediction.priceAtPrediction) * 100,
      },
      accuracy: {
        score: accuracy.score,
        label: accuracy.label,
        priceErrorPct: accuracy.priceErrorPct,
        isCorrect: accuracy.isCorrect,
      },
    });

    console.log(`Оценка: ${accuracy.label} (${accuracy.score}/100)`);
    console.log(`Ошибка цены: ${accuracy.priceErrorPct.toFixed(2)}%\n`);

  } catch (error) {
    console.error("\n❌ Ошибка прогноза:", error instanceof Error ? error.message : error);
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const symbol = args[0] || "BTC";
  const days = parseInt(args[1] || "30", 10);
  const model = args[2];

  console.log("🧪 Crypto AI Predictor - Бэктест\n");

  let coin;
  try {
    coin = await resolveCoinBySymbol(symbol);
  } catch (error) {
    console.error(`❌ Монета ${symbol} не найдена`);
    process.exit(1);
  }

  const results = await runBacktest(coin, "Futures", "24h", days, model);

  if (results.length === 0) {
    console.log("\n⚠️  Нет результатов для анализа");
    return;
  }

  const stats = calculateStats(results);

  console.log("\n" + "=".repeat(60));
  console.log("📊 СТАТИСТИКА БЭКТЕСТА");
  console.log("=".repeat(60) + "\n");

  console.log(`Всего прогнозов: ${stats.totalPredictions}`);
  console.log(`Точные (≥72): ${stats.accurateCount} (${(stats.winRate * 100).toFixed(1)}%)`);
  console.log(`Частичные (48-71): ${stats.partialCount}`);
  console.log(`Промахи (<48): ${stats.missedCount}`);
  console.log(`\nСредний score: ${stats.avgScore.toFixed(1)}/100`);
  console.log(`Средняя ошибка цены: ${stats.avgPriceError.toFixed(2)}%\n`);

  console.log("По направлениям:");
  for (const [dir, data] of Object.entries(stats.byDirection)) {
    if (data.count > 0) {
      console.log(
        `  ${dir}: ${data.count} прогнозов, Win Rate ${(data.winRate * 100).toFixed(1)}%, Score ${data.avgScore.toFixed(1)}`
      );
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("\n💡 Для полноценного бэктеста нужно:");
  console.log("1. Реализовать загрузку исторических свечей Binance");
  console.log("2. Прогонять prediction pipeline на каждом временном срезе");
  console.log("3. Собирать статистику за 30-90 дней");
  console.log("4. Сравнить несколько моделей (kr/deepseek-3.2, kr/claude-sonnet-4.5, etc)\n");
}

main().catch((err) => {
  console.error("💥 Критическая ошибка:", err);
  process.exit(1);
});