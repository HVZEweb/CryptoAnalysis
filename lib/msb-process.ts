import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

const MSB_DIR = path.join(process.cwd(), "microstructure_bot");
const JOB_FILE = path.join(MSB_DIR, ".msb-job.json");
const LOG_FILE = path.join(MSB_DIR, "continuous.log");

export type MsbJobId = "collect" | "daily" | "weekly" | "status";

export interface MsbJobState {
  id: MsbJobId;
  label: string;
  pid: number;
  startedAt: string;
  status: "running" | "completed" | "failed";
  exitCode: number | null;
  finishedAt: string | null;
  expectedMinutes: number;
}

const JOB_CONFIG: Record<MsbJobId, { label: string; args: string[]; expectedMinutes: number }> = {
  collect: {
    label: "Сборщик данных (WebSocket → Parquet)",
    args: ["main.py", "collect"],
    expectedMinutes: 0,
  },
  daily: {
    label: "Ежедневная проверка данных",
    args: ["main.py", "daily"],
    expectedMinutes: 2,
  },
  weekly: {
    label: "Еженедельное исследование (8 гипотез)",
    args: ["main.py", "weekly"],
    expectedMinutes: 15,
  },
  status: {
    label: "Инвентаризация данных",
    args: ["main.py", "status"],
    expectedMinutes: 1,
  },
};

function getPythonPath(): string {
  if (process.env.MSB_PYTHON) return process.env.MSB_PYTHON;
  const winVenv = path.join(MSB_DIR, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(winVenv)) return winVenv;
  const unixVenv = path.join(MSB_DIR, ".venv", "bin", "python");
  if (fs.existsSync(unixVenv)) return unixVenv;
  return "python";
}

function writeJob(state: MsbJobState) {
  fs.writeFileSync(JOB_FILE, JSON.stringify(state, null, 2), "utf8");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getMsbJob(): MsbJobState | null {
  if (!fs.existsSync(JOB_FILE)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(JOB_FILE, "utf8")) as MsbJobState;
    if (state.status === "running" && state.pid) {
      if (!isProcessAlive(state.pid)) {
        state.status = "failed";
        state.finishedAt = new Date().toISOString();
        state.exitCode = state.exitCode ?? -1;
        writeJob(state);
      }
    }
    return state;
  } catch {
    return null;
  }
}

export function readMsbLogTail(lines = 60): string {
  if (!fs.existsSync(LOG_FILE)) return "";
  try {
    return fs.readFileSync(LOG_FILE, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

let activeChild: ChildProcess | null = null;
let spawnLock = false;

export function startMsbJob(
  jobId: MsbJobId
): { ok: boolean; message: string; job?: MsbJobState } {
  if (spawnLock) {
    return { ok: false, message: "Запуск уже выполняется" };
  }
  const current = getMsbJob();
  if (current?.status === "running") {
    return { ok: false, message: `Уже выполняется: ${current.label}` };
  }

  const cfg = JOB_CONFIG[jobId];
  const pythonCmd = getPythonPath();
  if (!fs.existsSync(pythonCmd) && pythonCmd.includes(".venv")) {
    return {
      ok: false,
      message:
        "Python venv не найден. cd microstructure_bot && python -m venv .venv && pip install -r requirements.txt",
    };
  }

  try {
    spawnLock = true;
    const logFd = fs.openSync(LOG_FILE, "a");
    fs.writeSync(logFd, `\n--- ${cfg.label} ${new Date().toISOString()} ---\n`);

    const child = spawn(pythonCmd, cfg.args, {
      cwd: MSB_DIR,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    activeChild = child;

    const state: MsbJobState = {
      id: jobId,
      label: cfg.label,
      pid: child.pid || 0,
      startedAt: new Date().toISOString(),
      status: "running",
      exitCode: null,
      finishedAt: null,
      expectedMinutes: cfg.expectedMinutes,
    };
    writeJob(state);

    child.on("exit", (code) => {
      fs.closeSync(logFd);
      const done: MsbJobState = {
        ...state,
        status: code === 0 ? "completed" : "failed",
        exitCode: code,
        finishedAt: new Date().toISOString(),
      };
      writeJob(done);
      activeChild = null;
      spawnLock = false;
    });

    child.on("error", () => {
      try {
        fs.closeSync(logFd);
      } catch {
        // ignore
      }
      writeJob({
        ...state,
        status: "failed",
        exitCode: -1,
        finishedAt: new Date().toISOString(),
      });
      activeChild = null;
      spawnLock = false;
    });

    const hint =
      jobId === "collect"
        ? " Сборщик работает непрерывно — оставьте задачу запущенной."
        : "";
    return { ok: true, message: `Запущено: ${cfg.label}.${hint}`, job: state };
  } catch (e) {
    spawnLock = false;
    return { ok: false, message: e instanceof Error ? e.message : "Ошибка запуска" };
  }
}

export function getMsbJobCatalog() {
  return Object.entries(JOB_CONFIG).map(([id, cfg]) => ({
    id: id as MsbJobId,
    label: cfg.label,
    expectedMinutes: cfg.expectedMinutes,
    continuous: id === "collect",
  }));
}

export function isCollectorLikelyRunning(): boolean {
  const job = getMsbJob();
  return job?.id === "collect" && job.status === "running";
}
