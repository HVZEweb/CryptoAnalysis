/**
 * Сравнение производительности разных моделей Kiro AI
 * 
 * Тестирует скорость, качество JSON и точность прогнозов
 * Запуск: npx tsx scripts/compare-models.ts [symbol]
 * Пример: npx tsx scripts/compare-models.ts BTC
 */

import { resolveCoinBySymbol } from "@/lib/coins";
import { runPredictionPipeline } from "@/services/prediction";
import type { Coin, MarketType, Timeframe } from "@/types";

const KIRO_MODELS = [
  "kr/deepseek-3.2",
  "kr/claude-sonnet-4.5",
  "kr/qwen3-coder-next",
  "kr/claude-haiku-4.5",
  "kr/glm-5",
] as const;

interface ModelTestResult {
  model: string;
  success: boolean;
  duration: number;
  prediction?: {
    direction: string;
    probability: number;
    confidence: string;
    predictedPrice: number;
    priceAtPrediction: number;
    expectedMovePct: number;
  };
  error?: string;
}

async function testModel(
  coin: Coin,
  market: MarketType,
  timeframe: Timeframe,
  model: string
): Promise<ModelTestResult> {
  const start = Date.now();

  try {
    console.log(`\n🤖 Тестирую ${model}...`);

    const prediction = await runPredictionPipeline(
      coin,
      market,
      timeframe,
      (event) => {
        if (event.step === "ai_analysis") {
          process.stdout.write(`\r  ${event.message.slice(0, 50)}...`);
        }
      },
      model
    );

    const duration = Date.now() - start;
    console.log(`\n  ✅ Успешно за ${(duration / 1000).toFixed(1)}s`);

    return {
      model,
      success: true,
      duration,
      prediction: {
        direction: prediction.direction,
        probability: prediction.probability,
        confidence: prediction.confidence,
        predictedPrice: prediction.priceForecast?.predictedPrice ?? prediction.priceAtPrediction,
        priceAtPrediction: prediction.priceAtPrediction,
        expectedMovePct: prediction.priceForecast?.expectedMovePct ?? 0,
      },
    };
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(`\n  ❌ Ошибка: ${errorMsg.slice(0, 80)}`);

    return {
      model,
      success: false,
      duration,
      error: errorMsg,
    };
  }
}

function analyzeResults(results: ModelTestResult[]): void {
  console.log("\n" + "=".repeat(80));
  console.log("📊 РЕЗУЛЬТАТЫ СРАВНЕНИЯ МОДЕЛЕЙ");
  console.log("=".repeat(80) + "\n");

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0) {
    console.log("✅ Успешные модели:\n");

    const sorted = successful.sort((a, b) => a.duration - b.duration);

    sorted.forEach((r, i) => {
      console.log(`${i + 1}. ${r.model}`);
      console.log(`   Время: ${(r.duration / 1000).toFixed(1)}s`);
      if (r.prediction) {
        console.log(`   Прогноз: ${r.prediction.direction} (${r.prediction.probability}%)`);
        console.log(`   Confidence: ${r.prediction.confidence}`);
        console.log(
          `   Цена: $${r.prediction.priceAtPrediction.toFixed(2)} → $${r.prediction.predictedPrice.toFixed(2)} (${r.prediction.expectedMovePct >= 0 ? "+" : ""}${r.prediction.expectedMovePct.toFixed(2)}%)`
        );
      }
      console.log();
    });

    console.log("🏆 Лучшая модель по скорости:", sorted[0].model);
    console.log(`   ${(sorted[0].duration / 1000).toFixed(1)}s\n`);

    // Проверяем согласованность прогнозов
    const directions = successful.map((r) => r.prediction?.direction).filter(Boolean);
    const longCount = directions.filter((d) => d === "LONG").length;
    const shortCount = directions.filter((d) => d === "SHORT").length;
    const sidewaysCount = directions.filter((d) => d === "SIDEWAYS").length;

    console.log("📈 Согласованность прогнозов:");
    console.log(`   LONG: ${longCount}/${directions.length}`);
    console.log(`   SHORT: ${shortCount}/${directions.length}`);
    console.log(`   SIDEWAYS: ${sidewaysCount}/${directions.length}`);

    const maxCount = Math.max(longCount, shortCount, sidewaysCount);
    const consensus = (maxCount / directions.length) * 100;
    console.log(`   Консенсус: ${consensus.toFixed(0)}%`);

    if (consensus < 60) {
      console.log(
        "\n   ⚠️  Низкий консенсус между моделями — требуется доп. анализ"
      );
    } else {
      const consensusDirection =
        longCount === maxCount ? "LONG" : shortCount === maxCount ? "SHORT" : "SIDEWAYS";
      console.log(`\n   ✅ Большинство моделей согласны: ${consensusDirection}`);
    }
  }

  if (failed.length > 0) {
    console.log("\n❌ Недоступные модели:\n");
    failed.forEach((r) => {
      console.log(`- ${r.model}`);
      console.log(`  Ошибка: ${r.error?.slice(0, 100)}\n`);
    });
  }

  console.log("=".repeat(80));
  console.log("\n💡 Рекомендации:");
  
  if (successful.length >= 3) {
    const fastest = successful.sort((a, b) => a.duration - b.duration)[0];
    console.log(`\n1. Для production используйте: ${fastest.model}`);
    console.log(`   (самая быстрая, ${(fastest.duration / 1000).toFixed(1)}s)`);
    
    const fallbacks = successful.slice(1, 3).map(r => r.model);
    console.log(`\n2. Fallback модели: ${fallbacks.join(", ")}`);
  } else if (successful.length > 0) {
    console.log(`\n1. Доступна только: ${successful[0].model}`);
    console.log("   Рекомендуется добавить альтернативные модели");
  } else {
    console.log("\n⚠️  Ни одна модель не работает — проверьте конфигурацию OmniRoute");
  }

  console.log("\n3. Добавьте в .env:");
  console.log(`   OPENROUTER_MODEL=${successful[0]?.model || "kr/deepseek-3.2"}`);
  console.log(`   OPENROUTER_FALLBACK_MODELS=${successful.slice(1, 3).map(r => r.model).join(",")}`);
  console.log();
}

async function main() {
  const args = process.argv.slice(2);
  const symbol = args[0] || "BTC";

  console.log("🧪 Crypto AI Predictor - Сравнение моделей Kiro AI\n");
  console.log(`Тестируем ${KIRO_MODELS.length} моделей на ${symbol}/Futures/24h\n`);

  let coin: Coin;
  try {
    coin = await resolveCoinBySymbol(symbol);
    console.log(`✅ Монета: ${coin.name} (${coin.symbol})\n`);
  } catch (error) {
    console.error(`❌ Монета ${symbol} не найдена`);
    process.exit(1);
  }

  const results: ModelTestResult[] = [];

  for (const model of KIRO_MODELS) {
    const result = await testModel(coin, "Futures", "24h", model);
    results.push(result);

    // Пауза между запросами чтобы не перегрузить API
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  analyzeResults(results);
}

main().catch((err) => {
  console.error("\n💥 Критическая ошибка:", err);
  process.exit(1);
});