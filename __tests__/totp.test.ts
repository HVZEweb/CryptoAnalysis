import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  newRecoveryCodes,
  newTotpSecret,
  normalizeRecoveryCode,
  otpauthUrl,
  recoveryCodeHash,
  totpCode,
  totpStep,
  verifyTotp,
} from "@/lib/totp";

// RFC 6238 appendix B, SHA-1 key "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("matches the RFC 6238 test vectors", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpCode(RFC_SECRET, totpStep(59_000), 8)).toBe("94287082");
    expect(totpCode(RFC_SECRET, totpStep(1_111_111_109_000), 8)).toBe("07081804");
    expect(totpCode(RFC_SECRET, totpStep(20_000_000_000_000), 8)).toBe("65353130");
  });

  it("round-trips base32 and makes 160-bit secrets", () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });

  it("accepts the current code and one step of drift, never the same step twice", () => {
    const secret = newTotpSecret();
    const now = 1_800_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(secret, totpCode(secret, step), null, now)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 1), null, now)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), null, now)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step), step, now)).toBeNull(); // replay
    expect(verifyTotp(secret, "12345", null, now)).toBeNull();
  });

  it("builds an otpauth link for the authenticator app", () => {
    expect(otpauthUrl("ABC", "me@example.com")).toBe(
      "otpauth://totp/CryptoPredict%3Ame%40example.com?secret=ABC&issuer=CryptoPredict&algorithm=SHA1&digits=6&period=30"
    );
  });

  it("makes distinct recovery codes that match however they are typed", () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(recoveryCodeHash(codes[0].toUpperCase().replace("-", " "))).toBe(recoveryCodeHash(codes[0]));
    expect(normalizeRecoveryCode(" AbCdE-fGh2J ")).toBe("abcdefgh2j");
  });
});
