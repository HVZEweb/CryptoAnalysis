"use client";

import Link from "next/link";
import { AccountBar } from "@/components/account-bar";
import { DevMenu } from "@/components/dev-menu";
import type { AuthUser, QuotaStatus } from "@/types";

interface HeroProps {
  user: AuthUser | null;
  quota: QuotaStatus | null;
  onLogin: () => void;
  onRegister: () => void;
  onLogout: () => void;
  onUpgrade: () => void;
  /** Section navigation, shown as the header's second row */
  nav?: React.ReactNode;
}

/** The site's mark: a small square with a rising line — no gradients, readable at favicon size. */
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden>
      <rect width="28" height="28" rx="7" fill="#ededef" />
      <path d="M7 18.5 11.5 14l3 3L21 10.5" fill="none" stroke="#0a0a0b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Sticky top bar: brand and account on one row, the sections below it. */
export function Hero({ user, quota, onLogin, onRegister, onLogout, onUpgrade, nav }: HeroProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="CryptoPredict — на главную">
          <BrandMark />
          <span className="truncate text-[15px] font-semibold tracking-tight">CryptoPredict</span>
        </Link>
        <div className="flex items-center gap-2">
          {user?.role === "admin" && <DevMenu />}
          <AccountBar user={user} quota={quota} onLogin={onLogin} onRegister={onRegister} onLogout={onLogout} onUpgrade={onUpgrade} />
        </div>
      </div>
      {nav && <div className="mx-auto max-w-6xl px-2 sm:px-4">{nav}</div>}
    </header>
  );
}
