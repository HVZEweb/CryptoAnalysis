import fs from "fs/promises";
import path from "path";
import type { LlmLogEntry } from "@/services/news-impact/types";

const LOG_DIR = path.join(process.cwd(), ".cache", "news-impact");
const LOG_PATH = path.join(LOG_DIR, "llm-log.jsonl");
const MAX_MEMORY_LOGS = 40;

const memoryLogs: LlmLogEntry[] = [];

export function getRecentLlmLogs(limit = 20): LlmLogEntry[] {
  return memoryLogs.slice(-limit).reverse();
}

export async function appendLlmLog(entry: LlmLogEntry): Promise<void> {
  memoryLogs.push(entry);
  if (memoryLogs.length > MAX_MEMORY_LOGS) {
    memoryLogs.splice(0, memoryLogs.length - MAX_MEMORY_LOGS);
  }

  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(LOG_PATH, `${JSON.stringify(entry)}\n`, "utf-8");
  } catch {
    // non-fatal
  }
}

export async function loadLlmLogsFromDisk(limit = 30): Promise<LlmLogEntry[]> {
  try {
    const raw = await fs.readFile(LOG_PATH, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const parsed = lines
      .slice(-limit)
      .map((l) => JSON.parse(l) as LlmLogEntry)
      .reverse();
    for (const entry of parsed.reverse()) {
      if (!memoryLogs.some((m) => m.at === entry.at && m.newsId === entry.newsId && m.outcome === entry.outcome)) {
        memoryLogs.push(entry);
      }
    }
    if (memoryLogs.length > MAX_MEMORY_LOGS) {
      memoryLogs.splice(0, memoryLogs.length - MAX_MEMORY_LOGS);
    }
    return getRecentLlmLogs(limit);
  } catch {
    return getRecentLlmLogs(limit);
  }
}
