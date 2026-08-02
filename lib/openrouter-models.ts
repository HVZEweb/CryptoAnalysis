export const DEFAULT_OPENROUTER_MODEL = "cl/deepseek/deepseek-v4-flash";

/** 
 * Cline via OmniRoute — primary free provider when Kiro limits are exhausted.
 */
export const OPENROUTER_MODEL_FALLBACKS = [
  "cl/moonshotai/kimi-k2.6",
  "cl/google/gemini-3-flash-preview",
  "cl/deepseek/deepseek-v4-pro",
] as const;

export const OPENROUTER_MODEL_OPTIONS = [
  { value: "__default__", label: "По умолчанию (.env)" },
  { value: "cl/deepseek/deepseek-v4-flash", label: "Cline · DeepSeek V4 Flash (рекомендуется)" },
  { value: "cl/deepseek/deepseek-v4-pro", label: "Cline · DeepSeek V4 Pro" },
  { value: "cl/moonshotai/kimi-k2.6", label: "Cline · Kimi K2.6" },
  { value: "cl/google/gemini-3-flash-preview", label: "Cline · Gemini 3 Flash" },
  { value: "cl/google/gemini-3.1-pro-preview", label: "Cline · Gemini 3.1 Pro" },
  { value: "cl/anthropic/claude-sonnet-4.6", label: "Cline · Claude Sonnet 4.6" },
  { value: "kr/claude-sonnet-4.5", label: "Kiro · Claude Sonnet 4.5" },
  { value: "kr/deepseek-3.2", label: "Kiro · DeepSeek 3.2" },
] as const;

export function getModelLabel(modelId: string): string {
  const option = OPENROUTER_MODEL_OPTIONS.find((m) => m.value === modelId);
  return option?.label ?? modelId;
}

export function resolveModelCandidates(modelOverride?: string): string[] {
  const trimmed = modelOverride?.trim();
  if (trimmed && trimmed !== "__default__") {
    return [trimmed];
  }

  const primary = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
  const fromEnv = process.env.OPENROUTER_FALLBACK_MODELS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const fallbacks = fromEnv?.length ? fromEnv : [...OPENROUTER_MODEL_FALLBACKS];
  return [...new Set([primary, ...fallbacks])];
}
