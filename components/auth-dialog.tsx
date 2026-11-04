"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AuthForm, type AuthMode } from "@/components/auth-form";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After signing in or registering (refresh the account and quota) */
  onSuccess: () => void | Promise<void>;
  defaultTab?: "login" | "register";
}

const TEXT: Record<AuthMode, { title: string; description: string }> = {
  register: { title: "Регистрация", description: "Создайте аккаунт и получите ещё 2 бесплатных прогноза (всего 3)." },
  login: { title: "Вход", description: "Войдите, чтобы использовать свои прогнозы и подписку." },
  forgot: { title: "Сброс пароля", description: "Пришлём ссылку для нового пароля на почту." },
  twofa: { title: "Подтверждение входа", description: "Аккаунт защищён двухэтапным входом." },
};

export function AuthDialog({ open, onOpenChange, onSuccess, defaultTab = "register" }: AuthDialogProps) {
  const [mode, setMode] = useState<AuthMode>(defaultTab);
  useEffect(() => {
    if (open) setMode(defaultTab);
  }, [open, defaultTab]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{TEXT[mode].title}</DialogTitle>
          <DialogDescription>{TEXT[mode].description}</DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-6">
          {/* Remounted on every opening, so a half-filled second step never lingers. */}
          {open && (
            <AuthForm
              key={defaultTab}
              initialMode={defaultTab}
              onModeChange={setMode}
              onSuccess={async () => {
                await onSuccess();
                onOpenChange(false);
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
