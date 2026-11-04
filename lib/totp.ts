import { createHash, createHmac, randomBytes } from "crypto";

/**
 * Two-step sign-in with an authenticator app (Google Authenticator, Aegis, 1Password…): RFC 6238 TOTP,
 * SHA-1, 6 digits, 30-second steps, one step of clock drift either way. A step that was used once is refused
 * after that (the caller keeps the last accepted step), so an overheard code cannot be replayed.
 */
const STEP_S = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code for one 30-second step. */
export function totpCode(secret: string, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(n).padStart(digits, "0");
}

export const totpStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_S);

/** The accepted step for a code, or null: wrong, or a step at or before the last one used. */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const current = totpStep(now);
  for (const step of [current, current - 1, current + 1]) {
    if (lastStep != null && step <= lastStep) continue;
    if (totpCode(secret, step) === digits) return step;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer = "CryptoPredict"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`;
}

/** Ten one-time recovery codes like "k3m9x-q2w7p", for a lost phone. Only their hashes are stored. */
export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const s = base32Encode(randomBytes(7)).toLowerCase().slice(0, 10);
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z2-7]/g, "");
export const recoveryCodeHash = (code: string) => createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
