import { describe, expect, it } from "vitest";
import { clearLoginFailures, loginWait, recordLoginFailure } from "@/lib/login-throttle";

describe("per-account sign-in throttle", () => {
  it("lets 4 misses through, then waits 1, 2, 4… minutes, up to an hour", () => {
    const email = `t${Math.random()}@x.io`;
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) recordLoginFailure(email, t);
    expect(loginWait(email, t)).toBe(0);
    recordLoginFailure(email, t);
    expect(loginWait(email, t)).toBe(60_000);
    recordLoginFailure(email, t);
    expect(loginWait(email, t)).toBe(120_000);
    for (let i = 0; i < 20; i++) recordLoginFailure(email, t);
    expect(loginWait(email, t)).toBe(3_600_000);
    expect(loginWait(email.toUpperCase(), t)).toBe(3_600_000); // same account whatever the case
    clearLoginFailures(email);
    expect(loginWait(email, t)).toBe(0);
  });

  it("forgets old misses after a day", () => {
    const email = `t${Math.random()}@x.io`;
    for (let i = 0; i < 4; i++) recordLoginFailure(email, 0);
    recordLoginFailure(email, 25 * 3_600_000);
    expect(loginWait(email, 25 * 3_600_000)).toBe(0);
  });
});
