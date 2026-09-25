import axios from "axios";

/** axios, not fetch: only Node's HTTPS agent honours the VPN routing in lib/outbound-proxy. */
async function getText(url: string, headers?: Record<string, string>) {
  const res = await axios.get<string>(url, {
    headers,
    timeout: 10_000,
    responseType: "text",
    transformResponse: (d) => d,
    validateStatus: () => true,
  });
  const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");
  return { status: res.status, ok: res.status >= 200 && res.status < 300, text };
}

export async function checkOpenRouterReachability(): Promise<{
  ok: boolean;
  blocked: boolean;
  message: string;
}> {
  try {
    const response = await getText("https://openrouter.ai/api/v1/models");
    const text = response.text;

    if (response.status === 403 && text.includes("security policy")) {
      return {
        ok: false,
        blocked: true,
        message:
          "OpenRouter заблокирован в вашей сети/регионе (403 security policy). Сайт openrouter.ai недоступен — это не проблема API-ключа. Нужен VPN (EU/US) или другой AI-провайдер.",
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        blocked: false,
        message: `OpenRouter недоступен (HTTP ${response.status})`,
      };
    }

    return { ok: true, blocked: false, message: "OpenRouter доступен из вашей сети" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown";
    return {
      ok: false,
      blocked: false,
      message: `Не удалось подключиться к openrouter.ai: ${msg}`,
    };
  }
}

export async function checkOpenRouterKey(apiKey: string | undefined): Promise<{
  ok: boolean;
  status: number | null;
  blocked: boolean;
  message: string;
}> {
  const reachability = await checkOpenRouterReachability();
  if (!reachability.ok && reachability.blocked) {
    return {
      ok: false,
      status: 403,
      blocked: true,
      message: reachability.message,
    };
  }

  if (!apiKey?.trim()) {
    return {
      ok: false,
      status: null,
      blocked: false,
      message: "OPENROUTER_API_KEY не задан в .env",
    };
  }

  try {
    const response = await getText("https://openrouter.ai/api/v1/auth/key", {
      Authorization: `Bearer ${apiKey.trim()}`,
      "HTTP-Referer": "https://crypto-ai-predictor.local",
      "X-Title": "Crypto AI Predictor",
    });

    const text = response.text;
    if (response.ok) {
      return { ok: true, status: response.status, blocked: false, message: "Ключ OpenRouter принят" };
    }

    let detail = text.slice(0, 200);
    try {
      const json = JSON.parse(text) as { error?: string | { message?: string } };
      detail =
        typeof json.error === "string"
          ? json.error
          : json.error?.message ?? detail;
    } catch {
      // keep raw text
    }

    if (response.status === 403) {
      return {
        ok: false,
        status: 403,
        blocked: text.includes("security policy"),
        message:
          detail?.includes("security policy") || detail?.includes("Access denied")
            ? "OpenRouter заблокирован в вашей сети (403). VPN или другой AI-провайдер."
            : detail ?? "Доступ к OpenRouter запрещён (403). Проверьте ключ и настройки аккаунта.",
      };
    }
    if (response.status === 401) {
      return {
        ok: false,
        status: 401,
        blocked: false,
        message: "Неверный API-ключ OpenRouter (401). Проверьте OPENROUTER_API_KEY в .env",
      };
    }

    return {
      ok: false,
      status: response.status,
      blocked: false,
      message: `OpenRouter ответил ${response.status}: ${detail}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown";
    return { ok: false, status: null, blocked: false, message: `Не удалось связаться с OpenRouter: ${msg}` };
  }
}
