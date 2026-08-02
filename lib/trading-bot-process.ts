import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const PID_FILE = path.join(process.cwd(), "bot", ".trading.pid");
const LOG_FILE = path.join(process.cwd(), "bot", "trading.log");
const BOT_DIR = path.join(process.cwd(), "bot");

function getPythonPath(): string {
  if (process.env.BOT_PYTHON) return process.env.BOT_PYTHON;
  const winVenv = path.join(BOT_DIR, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(winVenv)) return winVenv;
  const unixVenv = path.join(BOT_DIR, ".venv", "bin", "python");
  if (fs.existsSync(unixVenv)) return unixVenv;
  return "python";
}

export function isTradingBotProcessRunning(): boolean {
  if (!fs.existsSync(PID_FILE)) return false;
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
    return false;
  }
}

export function readTradingLogTail(lines = 40): string {
  if (!fs.existsSync(LOG_FILE)) return "";
  try {
    return fs.readFileSync(LOG_FILE, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

export function startTradingBotProcess(): { ok: boolean; message: string; pid?: number } {
  if (isTradingBotProcessRunning()) {
    return { ok: true, message: "Trading bot уже запущен" };
  }

  const pythonCmd = getPythonPath();
  if (!fs.existsSync(pythonCmd) && pythonCmd.includes(".venv")) {
    return {
      ok: false,
      message: "Python venv не найден. Выполните: cd bot && python -m venv .venv && pip install -r requirements.txt",
    };
  }

  try {
    const logFd = fs.openSync(LOG_FILE, "a");
    fs.writeSync(logFd, `\n--- Trading bot start ${new Date().toISOString()} ---\n`);

    const child = spawn(pythonCmd, ["main.py"], {
      cwd: BOT_DIR,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env },
      windowsHide: true,
    });

    child.on("exit", () => {
      try {
        fs.closeSync(logFd);
      } catch {
        // ignore
      }
    });
    child.on("error", () => {
      try {
        fs.closeSync(logFd);
      } catch {
        // ignore
      }
    });

    child.unref();

    if (child.pid) {
      fs.writeFileSync(PID_FILE, String(child.pid));
      return {
        ok: true,
        message: `Unified Trading Bot запускается (${path.basename(pythonCmd)})…`,
        pid: child.pid,
      };
    }
    return { ok: false, message: "Не удалось получить PID" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Ошибка запуска" };
  }
}

export function stopTradingBotProcess(): boolean {
  if (!fs.existsSync(PID_FILE)) return false;
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
    process.kill(pid);
    fs.unlinkSync(PID_FILE);
    return true;
  } catch {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
    return false;
  }
}
