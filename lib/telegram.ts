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
  await axios.post(
    api(config.token, "sendMessage"),
    { chat_id: config.chatId, text, parse_mode: "HTML", disable_web_page_preview: true },
    { timeout: 12_000 }
  );
  return true;
}

/** Hides the token in error messages (it is part of the request URL). */
export function telegramError(e: unknown): string {
  const err = e as { response?: { data?: { description?: string } }; message?: string };
  return (err.response?.data?.description ?? err.message ?? String(e)).replace(/bot\d+:[\w-]+/g, "bot***");
}
