import axios from "axios";
import {
  getMessageContent,
  parseAndValidateAiResponse,
} from "@/lib/ai-response-parser";
import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt } from "@/lib/ai-prompts";
import {
  getModelLabel,
  resolveModelCandidates,
} from "@/lib/openrouter-models";
import type { AnalysisContext, ApiError, PredictionResult } from "@/types";

// OmniRoute URL из переменной окружения или дефолтный локальный
const getBaseURL = () => {
  return process.env.OMNIROUTE_URL || process.env.OPENROUTER_URL || "http://localhost:20128/v1";
};

const openrouterClient = axios.create({
  baseURL: getBaseURL(),
  timeout: 300_000,
});

interface OpenRouterMessage {
  content?: string | Array<{ type?: string; text?: string }>;
  reasoning?: string | Array<{ type?: string; text?: string }>;
  reasoning_details?: Array<{ type?: string; text?: string; content?: string }>;
}

interface OpenRouterChoice {
  message: OpenRouterMessage;
}

function extractRawMessage(message: OpenRouterMessage | undefined): string {
  if (!message) return "";

  const parts = [
    getMessageContent(message.content),
    getMessageContent(message.reasoning),
    ...(message.reasoning_details ?? []).map((d) => d.text ?? d.content ?? ""),
  ].filter(Boolean);

  if (parts.length === 0) return "";

  for (const part of parts) {
    if (part.includes("{") && part.includes("}")) return part;
  }

  return parts.join("\n");
}

const API_ERROR_CODES = new Set<ApiError["code"]>([
  "API_UNAVAILABLE",
  "OPENROUTER_ERROR",
  "RATE_LIMIT",
  "QUOTA_EXCEEDED",
  "NO_INTERNET",
  "INVALID_RESPONSE",
  "VALIDATION_ERROR",
  "UNKNOWN",
]);

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    API_ERROR_CODES.has((error as ApiError).code)
  );
}

function isRetryableModelError(error: unknown): boolean {
  if (!isApiError(error)) return false;

  const apiError = error;
  if (apiError.code === "RATE_LIMIT") return true;

  if (apiError.code === "OPENROUTER_ERROR") {
    const msg = apiError.message.toLowerCase();
    return (
      msg.includes("limit") ||
      msg.includes("quota") ||
      msg.includes("credit") ||
      msg.includes("rate") ||
      msg.includes("exhaust") ||
      msg.includes("capacity") ||
      msg.includes("unavailable") ||
      msg.includes("free tier") ||
      msg.includes("daily")
    );
  }

  return false;
}

export function normalizeOpenRouterError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return {
        code: "NO_INTERNET",
        message:
          error.code === "ECONNABORTED"
            ? "OpenRouter не успел ответить за 5 минут. Попробуйте снова или выберите другую модель."
            : "OpenRouter не отвечает. Проверьте подключение к интернету.",
      };
    }
    if (error.response.status === 429) {
      return {
        code: "RATE_LIMIT",
        message: "Превышен лимит запросов OpenRouter для этой модели.",
      };
    }
    if (error.response.status === 401) {
      const baseURL = getBaseURL();
      const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1");
      return {
        code: "OPENROUTER_ERROR",
        message: isLocal
          ? "Ошибка авторизации OmniRoute. Проверьте что OmniRoute запущен на " + baseURL
          : "Неверный API-ключ. Проверьте OPENROUTER_API_KEY в .env",
      };
    }
    if (error.response.status === 402) {
      const baseURL = getBaseURL();
      const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1");
      const body = error.response.data as { error?: string | { message?: string } } | undefined;
      const detail =
        typeof body?.error === "string"
          ? body.error
          : body?.error?.message;
      return {
        code: "OPENROUTER_ERROR",
        message: isLocal
          ? `OmniRoute: закончились кредиты или лимит модели (402). ${detail ? detail + ". " : ""}Проверьте баланс Kiro/OmniRoute или смените модель в .env.`
          : `OpenRouter: недостаточно кредитов (402). Пополните баланс на openrouter.ai/credits${detail ? ` — ${detail}` : ""}.`,
      };
    }
    if (error.response.status === 403) {
      const body = error.response.data as { error?: string | { message?: string } } | undefined;
      const detail =
        typeof body?.error === "string"
          ? body.error
          : body?.error?.message;
      return {
        code: "OPENROUTER_ERROR",
        message:
          detail?.includes("security policy") || detail?.includes("Access denied")
            ? "OpenRouter заблокировал API-ключ (403). Создайте новый ключ на openrouter.ai/settings/keys, вставьте в .env и перезапустите сервер."
            : detail ?? "Доступ к OpenRouter запрещён (403). Проверьте ключ и настройки аккаунта.",
      };
    }
    const body = error.response.data as { error?: { message?: string } } | undefined;
    return {
      code: "OPENROUTER_ERROR",
      message: body?.error?.message ?? "Ошибка OpenRouter API. Проверьте ключ и модель.",
    };
  }

  if (isApiError(error)) {
    return error;
  }

  const detail = error instanceof Error ? error.message : String(error);
  return {
    code: "UNKNOWN",
    message: detail ? `Ошибка генерации: ${detail}` : "Произошла ошибка при генерации прогноза.",
  };
}

async function generateWithModel(
  apiKey: string,
  model: string,
  ctx: AnalysisContext
): Promise<Omit<PredictionResult, "priceAtPrediction" | "coinId" | "analysis">> {
  const messages = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildUserPrompt(ctx) },
  ];

  let rawContent = await callOpenRouter(apiKey, model, messages, supportsJsonMode(model));
  let parsed = parseAndValidateAiResponse(rawContent, ctx);

  if (!parsed) {
    rawContent = await callOpenRouter(
      apiKey,
      model,
      [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildRepairPrompt(rawContent, ctx) },
      ],
      false
    );
    parsed = parseAndValidateAiResponse(rawContent, ctx);
  }

  if (!parsed) {
    const error: ApiError = {
      code: "INVALID_RESPONSE",
      message: `Модель ${getModelLabel(model)} вернула ответ в неверном формате. Попробуйте другую модель.`,
    };
    throw error;
  }

  return {
    ...parsed,
    market: ctx.market,
    timeframe: ctx.timeframe,
    createdAt: new Date().toISOString(),
  };
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  error?: { message?: string; code?: number };
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  useJsonMode: boolean
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 2500,
  };

  const baseURL = getBaseURL();
  const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1");
  if (isLocal) {
    body.stream = false;
  }

  if (useJsonMode) {
    body.response_format = { type: "json_object" };
  }

    // Для локального OmniRoute упрощенные headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Добавляем Authorization только если есть ключ
  if (apiKey && apiKey !== "none" && apiKey !== "local") {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  // Для OpenRouter добавляем дополнительные headers
  if (baseURL.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://crypto-ai-predictor.local";
    headers["X-Title"] = "Crypto AI Predictor";
  }

  const { data } = await openrouterClient.post<OpenRouterResponse>(
    "/chat/completions",
    body,
    { headers }
  );

  if (data.error?.message) {
    const error: ApiError = {
      code: "OPENROUTER_ERROR",
      message: data.error.message,
    };
    throw error;
  }

  const content = extractRawMessage(data.choices?.[0]?.message);
  if (!content) {
    const error: ApiError = {
      code: "INVALID_RESPONSE",
      message: "Модель вернула пустой ответ. Попробуйте снова или выберите другую модель.",
    };
    throw error;
  }

  return content;
}

function supportsJsonMode(model: string): boolean {
  const lower = model.toLowerCase();
  // Cline via OmniRoute rejects response_format=json_object (400/500)
  if (lower.startsWith("cl/") || lower.startsWith("cline/")) {
    return false;
  }
  // Kiro AI models через OmniRoute: проверим какие поддерживают response_format
  if (lower.startsWith("kr/")) {
    // DeepSeek, Claude, Qwen поддерживают JSON mode
    const supportsJson = ["deepseek", "claude", "qwen", "glm"];
    return supportsJson.some((name) => lower.includes(name));
  }
  // Отключаем JSON mode для моделей с известными проблемами
  const disabled = ["gemini", "nemotron", "nvidia", "poolside", "laguna", ":free", "deepseek-r1", "minimax"];
  return !disabled.some((name) => lower.includes(name));
}

export async function generateOpenRouterPrediction(
  ctx: AnalysisContext,
  modelOverride?: string
): Promise<Omit<PredictionResult, "priceAtPrediction" | "coinId" | "analysis">> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const models = resolveModelCandidates(modelOverride);

    // Для локального OmniRoute ключ может быть не нужен
  const baseURL = getBaseURL();
  const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1");
  
  if (!apiKey && !isLocal) {
    const error: ApiError = {
      code: "OPENROUTER_ERROR",
      message: "API ключ не настроен. Добавьте OPENROUTER_API_KEY в .env или OMNIROUTE_URL для локального",
    };
    throw error;
  }

  let lastError: ApiError | undefined;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      return await generateWithModel(apiKey ?? "", model, ctx);
    } catch (error) {
      const apiError = normalizeOpenRouterError(error);
      lastError = apiError;

      const hasFallback = i < models.length - 1;
      if (hasFallback && isRetryableModelError(apiError)) {
        continue;
      }

      throw apiError;
    }
  }

  throw (
    lastError ?? {
      code: "UNKNOWN",
      message: "Не удалось сгенерировать прогноз ни одной из моделей.",
    }
  );
}
