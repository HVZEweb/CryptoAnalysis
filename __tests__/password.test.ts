import { scryptSync } from "crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";

describe("password hashing", () => {
  it("verifies its own hashes and nothing else", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt$14$8$5$")).toBe(true);
    expect(await verifyPassword("correct horse battery", stored)).toEqual({ ok: true, needsRehash: false });
    expect((await verifyPassword("correct horse batterY", stored)).ok).toBe(false);
    expect(await hashPassword("same")).not.toBe(await hashPassword("same")); // salted
  });

  it("accepts the first version's hashes and asks to upgrade them", async () => {
    const salt = "00112233445566778899aabbccddeeff";
    const legacy = `${salt}:${scryptSync("old-password-1", salt, 64).toString("hex")}`;
    expect(await verifyPassword("old-password-1", legacy)).toEqual({ ok: true, needsRehash: true });
    expect((await verifyPassword("old-password-2", legacy)).ok).toBe(false);
  });

  it("refuses broken records and absurdly long input", async () => {
    expect((await verifyPassword("x", "garbage")).ok).toBe(false);
    expect((await verifyPassword("a".repeat(129), await hashPassword("a".repeat(128)))).ok).toBe(false);
  });

  it("rejects short, common, repeated and email-based passwords", () => {
    expect(passwordProblem("short1")).toMatch(/8 символов/);
    expect(passwordProblem("Password1")).toMatch(/распространён/);
    expect(passwordProblem("qwerty123")).toMatch(/распространён/);
    expect(passwordProblem("aaaaaaaaaa")).toMatch(/повторяющ/);
    expect(passwordProblem("ivanov2024!", "ivanov@mail.ru")).toMatch(/email/);
    expect(passwordProblem("x".repeat(129))).toMatch(/128/);
    expect(passwordProblem("lunar-tram-42", "ivanov@mail.ru")).toBeNull();
  });
});
