"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Clock, CreditCard, FileWarning, ServerCrash, WifiOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/types";

const ERROR_CONFIG: Record<
  ApiError["code"],
  { icon: React.ElementType; title: string }
> = {
  API_UNAVAILABLE: { icon: ServerCrash, title: "API недоступно" },
  OPENROUTER_ERROR: { icon: ServerCrash, title: "Ошибка OpenRouter" },
  RATE_LIMIT: { icon: Clock, title: "Превышен лимит" },
  QUOTA_EXCEEDED: { icon: CreditCard, title: "Лимит прогнозов" },
  NO_INTERNET: { icon: WifiOff, title: "Нет подключения" },
  INVALID_RESPONSE: { icon: FileWarning, title: "Неверный ответ" },
  VALIDATION_ERROR: { icon: AlertTriangle, title: "Ошибка валидации" },
  UNKNOWN: { icon: AlertTriangle, title: "Ошибка" },
};

interface ErrorAlertProps {
  error: ApiError;
  onAction?: () => void;
  actionLabel?: string;
}

export function ErrorAlert({ error, onAction, actionLabel }: ErrorAlertProps) {
  const config = ERROR_CONFIG[error.code] ?? ERROR_CONFIG.UNKNOWN;
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="flex items-start gap-4 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/20">
            <Icon className="h-5 w-5 text-destructive" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="font-semibold text-destructive">{config.title}</h4>
            <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
            {onAction && actionLabel && (
              <Button size="sm" className="mt-3 rounded-xl" onClick={onAction}>
                {actionLabel}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
