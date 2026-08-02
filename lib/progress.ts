export type PipelineStep =
  | "market_data"
  | "candles"
  | "indicators"
  | "sentiment"
  | "ai_analysis"
  | "ensemble"
  | "validation"
  | "done"
  | "error";

export const PIPELINE_STEP_LABELS: Record<PipelineStep, string> = {
  market_data: "Загрузка рыночных данных Binance",
  candles: "Получение свечей OHLCV",
  indicators: "Расчёт технических индикаторов",
  sentiment: "Анализ новостей и настроений",
  ai_analysis: "Генерация AI-прогноза",
  ensemble: "Ensemble: ML + правила + голосование",
  validation: "Коррекция уровней и направления",
  done: "Готово",
  error: "Ошибка",
};

export interface ProgressEvent {
  step: PipelineStep;
  progress: number;
  message: string;
}

export function formatSseEvent(event: ProgressEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
