import axios, { AxiosError } from "axios";
import type { ApiError } from "@/types";

const binanceClient = axios.create({
  baseURL: "https://api.binance.com/api/v3",
  timeout: 15000,
});

const binanceFuturesClient = axios.create({
  baseURL: "https://fapi.binance.com/fapi/v1",
  timeout: 15000,
});

/** Binance futures public data (OI hist, taker ratio, etc.) */
const binanceFuturesDataClient = axios.create({
  baseURL: "https://fapi.binance.com/futures/data",
  timeout: 15000,
});

const coingeckoClient = axios.create({
  baseURL: "https://api.coingecko.com/api/v3",
  timeout: 20000,
});

export { binanceClient, binanceFuturesClient, binanceFuturesDataClient, coingeckoClient };

export function mapAxiosError(error: unknown): ApiError {
  if (!axios.isAxiosError(error)) {
    return {
      code: "UNKNOWN",
      message: "Произошла неизвестная ошибка. Попробуйте позже.",
    };
  }

  const axiosError = error as AxiosError;

  if (!axiosError.response) {
    return {
      code: "NO_INTERNET",
      message: "Отсутствует подключение к интернету. Проверьте соединение.",
    };
  }

  if (axiosError.response.status === 429) {
    return {
      code: "RATE_LIMIT",
      message: "Превышен лимит запросов. Подождите немного и попробуйте снова.",
    };
  }

  if (axiosError.response.status >= 500) {
    return {
      code: "API_UNAVAILABLE",
      message: "API недоступно. Сервис временно не отвечает.",
    };
  }

  return {
    code: "API_UNAVAILABLE",
    message: "Не удалось получить данные. Попробуйте позже.",
  };
}

export function symbolToBinancePair(symbol: string, market: "Spot" | "Futures"): string {
  const base = symbol.toUpperCase().replace(/USDT$/, "");
  return market === "Futures" ? `${base}USDT` : `${base}USDT`;
}
