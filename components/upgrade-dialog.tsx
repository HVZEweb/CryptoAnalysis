"use client";

import { Crown, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UpgradeDialog({ open, onOpenChange }: UpgradeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-400" />
            Подписка на прогнозы
          </DialogTitle>
          <DialogDescription>
            Вы использовали все 3 бесплатных прогноза. Оформите подписку для неограниченного доступа.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 pb-6">
          <div className="rounded-2xl bg-gradient-to-br from-indigo-500/15 to-violet-500/10 p-4 ring-1 ring-indigo-500/20">
            <p className="font-display text-2xl font-bold">499 ₽<span className="text-sm font-normal text-muted-foreground">/мес</span></p>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                Неограниченные AI-прогнозы
              </li>
              <li className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                Полный анализ 18+ индикаторов
              </li>
              <li className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                История и точность прогнозов
              </li>
            </ul>
          </div>

          <Button className="w-full rounded-xl" disabled>
            Оплата скоро будет доступна
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Для ручной активации: POST <code className="text-[10px]">/api/webhooks/payment</code> с секретом{" "}
            <code className="text-[10px]">PAYMENT_WEBHOOK_SECRET</code> или панель{" "}
            <a href="/admin" className="text-indigo-300 underline">/admin</a>.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
