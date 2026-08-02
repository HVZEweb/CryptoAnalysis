import { z } from "zod";

export const predictionFormSchema = z.object({
  coinSymbol: z.string().min(1, "Выберите криптовалюту"),
  market: z.enum(["Spot", "Futures"]),
  timeframe: z.enum(["15m", "30m", "1h", "4h", "12h", "24h", "3d", "7d"]),
  model: z.string().optional(),
});

export type PredictionFormValues = z.infer<typeof predictionFormSchema>;

export const backtestFormSchema = z.object({
  coinSymbol: z.string().min(1),
  market: z.enum(["Spot", "Futures"]).default("Futures"),
  timeframe: z.enum(["15m", "30m", "1h", "4h", "12h", "24h", "3d", "7d"]).default("4h"),
  periodDays: z.number().int().min(7).max(730).default(90),
  mode: z.enum(["ensemble", "full"]).default("ensemble"),
  maxTrades: z.number().int().min(10).max(300).optional(),
  useDynamicWeights: z.boolean().optional(),
  walkForward: z
    .object({
      trainDays: z.number().int().min(14).default(60),
      testDays: z.number().int().min(7).default(14),
      stepDays: z.number().int().min(7).default(14),
    })
    .optional(),
  exportTraining: z.boolean().optional(),
  retrainMl: z.boolean().optional(),
});

export const priceForecastSchema = z.object({
  predictedPrice: z.coerce.number().positive(),
  predictedHigh: z.coerce.number().positive(),
  predictedLow: z.coerce.number().positive(),
  confidenceBand: z.object({
    low: z.coerce.number().positive(),
    high: z.coerce.number().positive(),
  }),
  expectedMovePct: z.coerce.number(),
});

export const tradeLevelsSchema = z.object({
  entry: z.coerce.number(),
  tp: z.coerce.number(),
  sl: z.coerce.number(),
  exit: z.coerce.number(),
});

export const aiResponseSchema = z.object({
  coin: z.string(),
  symbol: z.string(),
  market: z.enum(["Spot", "Futures"]),
  timeframe: z.string(),
  direction: z.enum(["LONG", "SHORT", "SIDEWAYS"]),
  probability: z.coerce.number().min(0).max(100),
  probabilityUp: z.coerce.number().min(0).max(100),
  probabilityDown: z.coerce.number().min(0).max(100),
  confidence: z.enum(["High", "Medium", "Low"]),
  priceRange: z.object({
    low: z.coerce.number(),
    high: z.coerce.number(),
  }),
  priceForecast: priceForecastSchema,
  tradeLevels: tradeLevelsSchema.optional(),
  reasons: z.array(z.string()).min(1),
  risks: z.array(z.string()).min(1),
  keyFactors: z.array(z.string()).min(1),
  recommendation: z.string(),
  disclaimer: z.string(),
});

export type AiResponse = z.infer<typeof aiResponseSchema>;
