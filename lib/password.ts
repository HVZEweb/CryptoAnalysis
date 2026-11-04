import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "crypto";

/**
 * Password hashing: scrypt N=2^14, r=8, p=5 — the OWASP minimum at 16 MB per hash, so a few sign-ins at once fit
 * the service's memory. Runs on the libuv pool (async): a sign-in never stalls other requests.
 * Stored as scrypt$<log2 N>$<r>$<p>$<salt>$<hash> (base64url). The first version stored "<salt hex>:<hash hex>"
 * with Node's defaults (N=2^14, r=8, p=1); such hashes still verify and are upgraded at the next sign-in.
 */
const PARAMS = { logN: 14, r: 8, p: 5 };
const KEY_LEN = 64;
const MAX_LEN = 128;

function derive(password: string, salt: Buffer | string, logN: number, r: number, p: number): Promise<Buffer> {
  const options: ScryptOptions = { N: 2 ** logN, r, p, maxmem: 2 ** logN * r * 128 * 2 };
  return new Promise((resolve, reject) => scrypt(password.normalize("NFKC"), salt, KEY_LEN, options, (e, key) => (e ? reject(e) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, PARAMS.logN, PARAMS.r, PARAMS.p);
  return ["scrypt", PARAMS.logN, PARAMS.r, PARAMS.p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (password.length > MAX_LEN) return { ok: false, needsRehash: false };
  try {
    if (stored.startsWith("scrypt$")) {
      const [, logN, r, p, salt, hash] = stored.split("$");
      const expected = Buffer.from(hash, "base64url");
      const derived = await derive(password, Buffer.from(salt, "base64url"), Number(logN), Number(r), Number(p));
      const ok = expected.length === derived.length && timingSafeEqual(expected, derived);
      const current = Number(logN) === PARAMS.logN && Number(r) === PARAMS.r && Number(p) === PARAMS.p;
      return { ok, needsRehash: ok && !current };
    }
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return { ok: false, needsRehash: false };
    const expected = Buffer.from(hash, "hex");
    // The first version hashed the raw string; the salt was used as text.
    const derived = await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, KEY_LEN, (e, key) => (e ? reject(e) : resolve(key))));
    const ok = expected.length === derived.length && timingSafeEqual(expected, derived);
    return { ok, needsRehash: ok };
  } catch {
    return { ok: false, needsRehash: false };
  }
}

let dummy: Promise<string> | null = null;

/** Spends the same time as a real check, so a sign-in with an unknown email answers no faster. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword(randomBytes(12).toString("hex"));
  await verifyPassword(password.slice(0, MAX_LEN), await dummy);
}

// The most common passwords of 8+ characters (international and Russian-speaking leaks).
const COMMON = new Set([
  "12345678", "123456789", "1234567890", "password", "password1", "password123", "qwertyuiop", "qwerty123", "qwerty12",
  "11111111", "00000000", "88888888", "87654321", "987654321", "12341234", "11223344", "1q2w3e4r", "1q2w3e4r5t",
  "1qaz2wsx", "zaq12wsx", "qazwsxedc", "q1w2e3r4", "q1w2e3r4t5", "asdfghjk", "zxcvbnm1", "iloveyou", "sunshine",
  "princess", "football", "baseball", "superman", "starwars", "trustno1", "welcome1", "whatever", "qwertyui",
  "abcd1234", "abc12345", "123qweasd", "123qweasdzxc", "qweasdzxc", "1234qwer", "qwer1234", "letmein1", "passw0rd",
  "p@ssw0rd", "admin123", "administrator", "michael1", "computer", "internet", "samsung1", "iloveyou1", "1password",
  "йцукенгш", "йцукен123", "пароль123", "parol123", "privet123", "nikita123", "natasha1", "marina123", "dragon12",
  "monkey12", "master12", "shadow12", "matrix12", "killer12", "hello123", "freedom1", "zxcvbnm123", "asdfghjkl",
  "1234567890q", "123456789a", "a123456789", "q123456789", "123456qwerty", "qwerty1234", "qwerty12345", "crypto123",
  "bitcoin1", "bitcoin123", "ethereum", "binance1", "cryptopredict",
]);

/** Why a new password is not acceptable, or null. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 8) return "Пароль — минимум 8 символов";
  if (password.length > MAX_LEN) return `Пароль — не длиннее ${MAX_LEN} символов`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "Этот пароль слишком распространён — придумайте другой";
  if (/^(.)\1+$/.test(password)) return "Пароль из одного повторяющегося символа слишком простой";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "Пароль не должен содержать имя из email";
  return null;
}

export const PASSWORD_MAX_LENGTH = MAX_LEN;
