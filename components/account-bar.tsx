"use client";

import Link from "next/link";
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
          <span className="font-medium text-amber-300">
            ∞ прогнозов
            {quota.paidUntil ? (
              <span className="font-normal text-muted-foreground">
                {" "}· до {new Date(quota.paidUntil).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}
              </span>
            ) : null}
          </span>
        ) : (
          <span>
            Осталось: <span className="font-semibold text-foreground">{remaining}</span> из {limit}
          </span>
        )}
      </div>

      {user ? (
        <>
          <Link
            href="/account"
            title="Аккаунт и безопасность"
            className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            <User className="h-3.5 w-3.5" />
            <span className="hidden max-w-[180px] truncate sm:inline">{user.email}</span>
            {user.role === "admin" && (
              <span className="hidden rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300 sm:inline">админ</span>
            )}
            {user.emailVerified === false && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="email не подтверждён" />}
          </Link>
          {quota?.tier !== "paid" ? (
            <Button size="sm" variant={quota?.requiresPayment ? "default" : "secondary"} className="h-8 rounded-xl text-xs" onClick={onUpgrade}>
              Подписка
            </Button>
          ) : quota.paidUntil ? (
            <Button size="sm" variant="ghost" className="h-8 rounded-xl text-xs" onClick={onUpgrade}>
              Продлить
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="h-8 rounded-xl text-xs" onClick={onLogout} aria-label="Выйти" title="Выйти">
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
