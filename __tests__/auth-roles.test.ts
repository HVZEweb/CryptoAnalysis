import { scryptSync } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { execute, query } from "@/lib/db";
import {
  changePassword,
  checkPassword,
  createPasswordResetToken,
  createUser,
  enableTwoFactor,
  findUserByEmail,
  isSignupOpen,
  loginSecondStep,
  loginUser,
  registerUser,
  resetPasswordWithToken,
  setUserRole,
  startTwoFactorSetup,
  verifyEmailWithToken,
  createEmailVerifyToken,
} from "@/lib/auth";
import { lookupSession, revokeUserSessions, SESSION_IDLE_MS, SESSION_MAX_MS, tokenHash } from "@/lib/sessions";
import { clearLoginFailures } from "@/lib/login-throttle";
import { totpCode, totpStep } from "@/lib/totp";

// Touches real tables, so it only runs against a throwaway *_ci database (as in CI).
const onCiDb = (process.env.DB_NAME ?? "").endsWith("_ci");

const signedIn = async (email: string, password: string) => {
  const r = await loginUser(email, password);
  if (!("token" in r)) throw new Error("expected a session, got a 2FA challenge");
  return r;
};

describe.runIf(onCiDb)("sign-in, sessions and roles", () => {
  beforeAll(async () => {
    await execute("DELETE FROM user_sessions");
    await execute("DELETE FROM auth_tokens");
    await execute("DELETE FROM users");
  });

  it("makes the first account the admin and later ones plain users", async () => {
    const first = await registerUser("owner@example.com", "lunar-tram-41");
    const second = await createUser("member@example.com", "lunar-tram-42");
    expect(first.user.role).toBe("admin");
    expect(second.role).toBe("user");
    expect((await signedIn("member@example.com", "lunar-tram-42")).user.role).toBe("user");
  });

  it("refuses duplicate emails, weak passwords and bad addresses", async () => {
    await expect(createUser("MEMBER@example.com", "lunar-tram-43")).rejects.toThrow(/уже есть/);
    await expect(createUser("new@example.com", "password1")).rejects.toThrow(/распространён/);
    await expect(createUser("not-an-email", "lunar-tram-44")).rejects.toThrow(/email/);
  });

  it("never removes the last admin", async () => {
    const admin = (await signedIn("owner@example.com", "lunar-tram-41")).user;
    expect(await setUserRole(admin.id, "user")).toBe("last_admin");
  });

  it("closes signup on a private site once someone exists", async () => {
    process.env.SITE_PRIVATE = "true";
    expect(await isSignupOpen()).toBe(false);
    process.env.ALLOW_SIGNUP = "true";
    expect(await isSignupOpen()).toBe(true);
    delete process.env.ALLOW_SIGNUP;
    delete process.env.SITE_PRIVATE;
    expect(await isSignupOpen()).toBe(true);
  });

  it("keeps only the token's hash and slides the session on activity, within 90 days", async () => {
    const { token, user } = await signedIn("member@example.com", "lunar-tram-42");
    const rows = await query<Array<{ id: string }>>("SELECT id FROM user_sessions WHERE user_id = ?", [user.id]);
    expect(rows.map((r) => r.id)).toContain(tokenHash(token));
    expect(rows.map((r) => r.id)).not.toContain(token);

    const t0 = Date.now();
    const later = await lookupSession(token, {}, t0 + 2 * 3_600_000);
    expect(later?.renewed).toBe(true);
    expect(later!.expiresAt).toBeGreaterThan(t0 + SESSION_IDLE_MS);
    expect(await lookupSession(token, {}, t0 + SESSION_MAX_MS + 60_000)).toBeNull();
    expect(await lookupSession("not-a-token")).toBeNull();
  });

  it("makes an account wait after five wrong passwords, and an unknown email looks the same", async () => {
    expect((await checkPassword("nobody@example.com", "whatever-1")).status).toBe("invalid");
    for (let i = 0; i < 5; i++) expect((await checkPassword("member@example.com", `wrong-${i}`)).status).toBe("invalid");
    expect((await checkPassword("member@example.com", "lunar-tram-42")).status).toBe("locked");
    clearLoginFailures("member@example.com");
    expect((await checkPassword("member@example.com", "lunar-tram-42")).status).toBe("ok");
  });

  it("upgrades a first-version password hash at sign-in", async () => {
    const salt = "00112233445566778899aabbccddeeff";
    await execute("UPDATE users SET password_hash = ? WHERE email = ?", [`${salt}:${scryptSync("lunar-tram-42", salt, 64).toString("hex")}`, "member@example.com"]);
    await signedIn("member@example.com", "lunar-tram-42");
    const row = await query<Array<{ password_hash: string }>>("SELECT password_hash FROM users WHERE email = ?", ["member@example.com"]);
    expect(row[0].password_hash.startsWith("scrypt$")).toBe(true);
  });

  it("changing the password keeps this device and signs out the others", async () => {
    const a = await signedIn("member@example.com", "lunar-tram-42");
    const b = await signedIn("member@example.com", "lunar-tram-42");
    const sessionA = (await lookupSession(a.token))!;
    await expect(changePassword(a.user.id, "wrong-current", "violet-ferry-77", sessionA.id)).rejects.toThrow(/Текущий/);
    await changePassword(a.user.id, "lunar-tram-42", "violet-ferry-77", sessionA.id);
    expect(await lookupSession(a.token)).not.toBeNull();
    expect(await lookupSession(b.token)).toBeNull();
    expect((await checkPassword("member@example.com", "violet-ferry-77")).status).toBe("ok");
  });

  it("resets a password by a one-time link, signs out everywhere and confirms the email", async () => {
    const before = await signedIn("member@example.com", "violet-ferry-77");
    const reset = await createPasswordResetToken("member@example.com");
    expect(await createPasswordResetToken("nobody@example.com")).toBeNull();
    await expect(resetPasswordWithToken(reset!.token, "short")).rejects.toThrow(/8 символов/);
    expect(await resetPasswordWithToken(reset!.token, "amber-canal-19")).toBe(true);
    expect(await resetPasswordWithToken(reset!.token, "amber-canal-20")).toBe(false); // used up
    expect(await lookupSession(before.token)).toBeNull();
    const user = await findUserByEmail("member@example.com");
    expect(user?.emailVerifiedAt).not.toBeNull();
  });

  it("confirms an email once per link", async () => {
    const owner = await findUserByEmail("owner@example.com");
    const token = await createEmailVerifyToken(owner!.id);
    expect((await verifyEmailWithToken(token))?.email).toBe("owner@example.com");
    expect(await verifyEmailWithToken(token)).toBeNull();
  });

  it("asks for an authenticator code after the password, refuses replays, accepts a recovery code once", async () => {
    const owner = (await findUserByEmail("owner@example.com"))!;
    const secret = await startTwoFactorSetup(owner.id);
    // A code from 2 steps ago so that the sign-ins below can use later steps.
    const recovery = await enableTwoFactor(owner.id, totpCode(secret, totpStep() - 1));
    expect(recovery).toHaveLength(10);
    await revokeUserSessions(owner.id);

    const first = await loginUser("owner@example.com", "lunar-tram-41");
    expect("twoFactor" in first).toBe(true);
    const challenge = (first as { twoFactor: string }).twoFactor;
    await expect(loginSecondStep(challenge, "000000")).rejects.toThrow(/Неверный код/);
    const ok = await loginSecondStep(challenge, totpCode(secret, totpStep()));
    expect(ok.user.email).toBe("owner@example.com");
    await expect(loginSecondStep(challenge, totpCode(secret, totpStep()))).rejects.toThrow(/заново/); // challenge used

    const second = (await loginUser("owner@example.com", "lunar-tram-41")) as { twoFactor: string };
    await expect(loginSecondStep(second.twoFactor, totpCode(secret, totpStep()))).rejects.toThrow(/Неверный код/); // same step again
    expect((await loginSecondStep(second.twoFactor, recovery[0].toUpperCase())).user.email).toBe("owner@example.com");

    const third = (await loginUser("owner@example.com", "lunar-tram-41")) as { twoFactor: string };
    await expect(loginSecondStep(third.twoFactor, recovery[0])).rejects.toThrow(/Неверный код/); // recovery code used
  });

  it("drops a second-step challenge after five wrong codes", async () => {
    const r = (await loginUser("owner@example.com", "lunar-tram-41")) as { twoFactor: string };
    for (let i = 0; i < 5; i++) await expect(loginSecondStep(r.twoFactor, "000000")).rejects.toThrow();
    await expect(loginSecondStep(r.twoFactor, "000000")).rejects.toThrow(/заново/);
  });
});
