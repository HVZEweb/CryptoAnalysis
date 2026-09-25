"use client";

import { LogIn, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AuthUser, QuotaStatus } from "@/types";
import { cn } from "@/lib/utils";

interface AccountBarProps {
  user: AuthUser | null;
  quota: QuotaStatus | null;
  onLogin: () => void;
  onRegister: () => void;
  onLogout: () => void;
  onUpgrade: () => void;
}

export function AccountBar({ user, quota, onLogin, onRegister, onLogout, onUpgrade }: AccountBarProps) {
  const remaining = quota?.remaining ?? 0;
  const limit = quota?.limit ?? 1;
  const low = remaining <= 0;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div
        className={cn(
          "rounded-xl px-3 py-1.5 text-xs ring-1",
          low ? "bg-red-500/10 text-red-300 ring-red-500/20" : "bg-white/5 text-muted-foreground ring-white/10"
        )}
      >
        {quota?.tier === "paid" ? (
          <span className="font-medium text-amber-300">∞ прогнозов</span>
        ) : (
          <span>
            Осталось: <span className="font-semibold text-foreground">{remaining}</span> из {limit}
          </span>
        )}
      </div>

      {user ? (
        <>
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <User className="h-3.5 w-3.5" />
            {user.email}
            {user.role === "admin" && (
              <span className="rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">админ</span>
            )}
          </span>
          {quota?.requiresPayment && (
            <Button size="sm" variant="default" className="h-8 rounded-xl text-xs" onClick={onUpgrade}>
              Купить доступ
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-8 rounded-xl text-xs" onClick={onLogout}>
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="ghost" className="h-8 rounded-xl text-xs" onClick={onLogin}>
            <LogIn className="h-3.5 w-3.5" /> Вход
          </Button>
          <Button size="sm" className="h-8 rounded-xl text-xs" onClick={onRegister}>
            +2 прогноза
          </Button>
        </>
      )}
    </div>
  );
}
