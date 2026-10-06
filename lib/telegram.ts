/**
 * Telegram bot for trade signals. The token and chat can come from the environment
 * (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) or be connected from the admin page, which stores them
 * in .cache/telegram.json — the service may write there, and it needs no server access.
 *
 * Requests go through axios so the global HTTPS agent (and the VPN binding for api.telegram.org)
 * applies; the built-in fetch would bypass it.
 */

import fs from "fs";
import path from "path";
import axios from "axios";

const SETTINGS_FILE = path.join(process.cwd(), ".cache", "telegram.json");
const HEALTH_FILE = path.join(process.cwd(), ".cache", "telegram-health.json");

/**
 * Whether the bot can reach Telegram: the last successful request and the last failure. Kept on disk
 * so the site can warn when messages stop going out (in September 2026 the VPN address changed and
 * nothing was delivered for a week without anyone noticing).
 */
export interface TelegramHealth {
  lastOkAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  /** Failures since the last success */
  failures: number;
}

let health: TelegramHealth | null = null;

export function telegramHealth(): TelegramHealth {
  if (!health) {
    try {
      health = JSON.parse(fs.readFileSync(HEALTH_FILE, "utf-8")) as TelegramHealth;
    } catch {
      health = { lastOkAt: null, lastErrorAt: null, lastError: null, failures: 0 };
    }
  }
  return health;
}

let savedAt = 0;

/**
 * Records the outcome of a Telegram request. The bot polls every few seconds, so the file is written
 * when the state flips and otherwise at most every ten minutes.
 */
export function recordTelegram(ok: boolean, error?: unknown, now = Date.now()): void {
  const h = telegramHealth();
  const flipped = ok ? h.failures > 0 || h.lastOkAt == null : h.failures === 0;
  if (ok) {
    h.lastOkAt = now;
    h.failures = 0;
  } else {
    h.lastErrorAt = now;
    h.lastError = telegramError(error).slice(0, 200);
    h.failures++;
  }
  if (!flipped && now - savedAt < 10 * 60_000) return;
  savedAt = now;
  try {
    fs.mkdirSync(path.dirname(HEALTH_FILE), { recursive: true });
    fs.writeFileSync(HEALTH_FILE, JSON.stringify(h) + "\n");
  } catch {
    // the warning is a convenience; never fail a send over it
  }
}

/** Failing now: the last request failed and nothing has succeeded since. */
export function telegramFailing(h = telegramHealth()): boolean {
  return h.failures > 0 && (h.lastOkAt == null || (h.lastErrorAt ?? 0) > h.lastOkAt);
}

export interface TelegramConfig {
  token: string;
  chatId: string;
  source: "env" | "admin";
}

interface StoredSettings {
  token?: string;
  chatId?: string;
}

function readStored(): StoredSettings {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) as StoredSettings;
  } catch {
    return {};
  }
}

export function saveTelegramSettings(settings: StoredSettings): void {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings) + "\n", { mode: 0o600 });
}

export function clearTelegramSettings(): void {
  fs.rmSync(SETTINGS_FILE, { force: true });
}

export function getTelegramConfig(): TelegramConfig | null {
  const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const envChat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (envToken && envChat) return { token: envToken, chatId: envChat, source: "env" };
  const stored = readStored();
  if (stored.token && stored.chatId) return { token: stored.token, chatId: stored.chatId, source: "admin" };
  return null;
}

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

/** Checks a token and returns the bot's @username. */
export async function botUsername(token: string): Promise<string> {
  const { data } = await axios.get<{ ok: boolean; result: { username: string } }>(api(token, "getMe"), { timeout: 12_000 });
  return data.result.username;
}

/** The chat of the most recent private message to the bot — how the admin page finds who to write to. */
export async function latestPrivateChat(token: string): Promise<{ chatId: string; name: string } | null> {
  const { data } = await axios.get<{
    result: Array<{ message?: { chat: { id: number; type: string; first_name?: string; username?: string } } }>;
  }>(api(token, "getUpdates"), { timeout: 12_000 });
  const chats = data.result.map((u) => u.message?.chat).filter((c) => c && c.type === "private");
  const chat = chats.at(-1);
  return chat ? { chatId: String(chat.id), name: chat.username ? `@${chat.username}` : (chat.first_name ?? String(chat.id)) } : null;
}

export async function sendTelegram(text: string, config = getTelegramConfig()): Promise<boolean> {
  if (!config) return false;
  try {
    await axios.post(
      api(config.token, "sendMessage"),
      { chat_id: config.chatId, text, parse_mode: "HTML", disable_web_page_preview: true },
      { timeout: 12_000 }
    );
  } catch (e) {
    recordTelegram(false, e);
    throw e;
  }
  recordTelegram(true);
  return true;
}

/** Hides the token in error messages (it is part of the request URL). */
export function telegramError(e: unknown): string {
  const err = e as { response?: { data?: { description?: string } }; message?: string };
  return (err.response?.data?.description ?? err.message ?? String(e)).replace(/bot\d+:[\w-]+/g, "bot***");
}
