/**
 * Slows password guessing on one account, whatever addresses the guesses come from: after 5 wrong passwords
 * the account waits 1 minute, and the wait doubles with every further miss, up to an hour. A correct password
 * clears it. Kept in memory: the site runs as one process, and a restart only resets a wait.
 */
const FREE_FAILURES = 5;
const BASE_LOCK_MS = 60_000;
const MAX_LOCK_MS = 3_600_000;
const FORGET_MS = 24 * 3_600_000;

interface Entry {
  failures: number;
  lockedUntil: number;
  lastAt: number;
}

const accounts = new Map<string, Entry>();

const key = (email: string) => email.trim().toLowerCase();

/** Milliseconds this account must still wait before another password is checked (0 = may try now). */
export function loginWait(email: string, now = Date.now()): number {
  const e = accounts.get(key(email));
  return e ? Math.max(0, e.lockedUntil - now) : 0;
}

export function recordLoginFailure(email: string, now = Date.now()): void {
  const k = key(email);
  const e = accounts.get(k) ?? { failures: 0, lockedUntil: 0, lastAt: now };
  if (now - e.lastAt > FORGET_MS) e.failures = 0;
  e.failures += 1;
  e.lastAt = now;
  if (e.failures >= FREE_FAILURES) {
    e.lockedUntil = now + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (e.failures - FREE_FAILURES));
  }
  accounts.set(k, e);
  if (accounts.size > 10_000) {
    for (const [k2, e2] of accounts) if (now - e2.lastAt > FORGET_MS) accounts.delete(k2);
  }
}

export function clearLoginFailures(email: string): void {
  accounts.delete(key(email));
}

export function waitMessage(ms: number): string {
  const min = Math.ceil(ms / 60_000);
  return `Слишком много неверных паролей для этого аккаунта. Попробуйте через ${min} мин или восстановите пароль.`;
}
