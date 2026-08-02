/**
 * Тест подключения к локальному OmniRoute
 * Запуск: npx tsx scripts/test-omniroute.ts
 */

import axios from "axios";

async function testOmniRoute() {
  const baseURL = process.env.OMNIROUTE_URL || process.env.OPENROUTER_URL || "http://localhost:11434/v1";
  const apiKey = process.env.OPENROUTER_API_KEY;

  console.log("🔍 Тестирование подключения к OmniRoute\n");
  console.log(`Base URL: ${baseURL}`);
  console.log(`API Key: ${apiKey ? "установлен" : "не установлен"}\n`);

  // Тест 1: Проверка доступности
  console.log("1️⃣ Проверка доступности сервера...");
  try {
    const response = await axios.get(`${baseURL.replace("/v1", "")}/health`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    console.log(`✅ Сервер отвечает (${response.status})\n`);
  } catch (error) {
    console.log(`⚠️ Health endpoint недоступен (это нормально для некоторых API)\n`);
  }

  // Тест 2: Список моделей
  console.log("2️⃣ Получение списка моделей...");
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey && apiKey !== "none") {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await axios.get(`${baseURL}/models`, {
      headers,
      timeout: 10000,
    });

    const models = response.data?.data || response.data?.models || [];
    console.log(`✅ Найдено моделей: ${models.length}\n`);
    
    if (models.length > 0) {
      console.log("Доступные модели:");
      models.slice(0, 10).forEach((m: any, i: number) => {
        const id = m.id || m.name || m;
        console.log(`  ${i + 1}. ${id}`);
      });
      if (models.length > 10) {
        console.log(`  ... и еще ${models.length - 10}\n`);
      }
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.log(`❌ Ошибка: ${error.response?.status} ${error.response?.statusText}`);
      console.log(`   ${JSON.stringify(error.response?.data)}\n`);
    } else {
      console.log(`❌ Ошибка: ${error}\n`);
    }
  }

  // Тест 3: Простой запрос к модели
  console.log("3️⃣ Тестовый запрос к модели...");
  try {
    const testModel = process.env.OPENROUTER_MODEL || "kr/claude-sonnet-4.5";
    console.log(`Модель: ${testModel}\n`);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey && apiKey !== "none") {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const start = Date.now();
    const response = await axios.post(
      `${baseURL}/chat/completions`,
      {
        model: testModel,
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Say 'Hello, OmniRoute works!' and nothing else." },
        ],
        temperature: 0.2,
        max_tokens: 50,
      },
      {
        headers,
        timeout: 60000,
      }
    );

    const duration = Date.now() - start;
    const content = response.data?.choices?.[0]?.message?.content || "(пустой ответ)";
    
    console.log(`✅ Ответ получен за ${(duration / 1000).toFixed(1)}s`);
    console.log(`Модель ответила: ${content}\n`);
    console.log("🎉 Все тесты пройдены! OmniRoute работает корректно.\n");
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.log(`❌ Ошибка при запросе к модели:`);
      console.log(`   Status: ${error.response?.status}`);
      console.log(`   Message: ${JSON.stringify(error.response?.data)}\n`);
      
      if (error.response?.status === 401) {
        console.log("💡 Рекомендация: Проверьте OPENROUTER_API_KEY в .env");
        console.log("   Или установите OMNIROUTE_URL если используете локальный сервер без auth\n");
      }
      if (error.response?.status === 404) {
        console.log("💡 Рекомендация: Модель не найдена. Проверьте список доступных моделей выше\n");
      }
    } else {
      console.log(`❌ Непредвиденная ошибка: ${error}\n`);
    }
  }

  console.log("=".repeat(60));
  console.log("\n📝 Настройка .env для OmniRoute:\n");
  console.log("# Если OmniRoute на другом порту/хосте:");
  console.log("OMNIROUTE_URL=http://localhost:ПОРТ/v1\n");
  console.log("# Если нужна авторизация:");
  console.log("OPENROUTER_API_KEY=your-key\n");
  console.log("# Модель (используйте ID из списка выше):");
  console.log("OPENROUTER_MODEL=kr/deepseek-3.2\n");
}

testOmniRoute().catch((err) => {
  console.error("\n💥 Критическая ошибка:", err);
  process.exit(1);
});
