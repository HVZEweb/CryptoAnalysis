import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

const BOT_DIR = path.join(process.cwd(), "bot");
const JOB_FILE = path.join(BOT_DIR, ".maintenance-job.json");
const LOG_FILE = path.join(BOT_DIR, "maintenance.log");

export type MaintenanceJobId = "archive" | "archive-l2" | "coverage" | "phase-x";

export interface MaintenanceJobState {
  id: MaintenanceJobId;
  label: string;
  pid: number;
  startedAt: string;
  status: "running" | "completed" | "failed";
  exitCode: number | null;
  finishedAt: string | null;
  expectedMinutes: number;
}

const JOB_CONFIG: Record<
  MaintenanceJobId,
  { label: string; args: string[]; expectedMinutes: number }
> = {
  archive: {
    label: "Ежедневный архив данных",
    args: ["-m", "alpha.run_archive", "--skip-l2"],
    expectedMinutes: 1,
  },
  "archive-l2": {
    label: "Архив + L2 снимки",
    args: ["-m", "alpha.run_archive", "--l2-duration", "120"],
    expectedMinutes: 8,
  },
  coverage: {
    label: "Coverage + Quality",
    args: ["-m", "alpha.run_phase_x", "--no-discovery"],
    expectedMinutes: 1,
  },
  "phase-x": {
    label: "Полный Phase X + Discovery",
    args: ["-m", "alpha.run_phase_x", "--bars", "0"],
    expectedMinutes: 35,
  },
};

function getPythonPath(): string {
  if (process.env.BOT_PYTHON) return process.env.BOT_PYTHON;
  const winVenv = path.join(BOT_DIR, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(winVenv)) return winVenv;
  const unixVenv = path.join(BOT_DIR, ".venv", "bin", "python");
  if (fs.existsSync(unixVenv)) return unixVenv;
  return "python";
}

function writeJob(state: MaintenanceJobState) {
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

export function getMaintenanceJob(): MaintenanceJobState | null {
  if (!fs.existsSync(JOB_FILE)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(JOB_FILE, "utf8")) as MaintenanceJobState;
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

export function readMaintenanceLogTail(lines = 60): string {
  if (!fs.existsSync(LOG_FILE)) return "";
  try {
    return fs.readFileSync(LOG_FILE, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

let activeChild: ChildProcess | null = null;
let spawnLock = false;

export function startMaintenanceJob(
  jobId: MaintenanceJobId
): { ok: boolean; message: string; job?: MaintenanceJobState } {
  if (spawnLock) {
    return { ok: false, message: "Запуск уже выполняется" };
  }
  const current = getMaintenanceJob();
  if (current?.status === "running") {
    return { ok: false, message: `Уже выполняется: ${current.label}` };
  }

  const cfg = JOB_CONFIG[jobId];
  const pythonCmd = getPythonPath();
  if (!fs.existsSync(pythonCmd) && pythonCmd.includes(".venv")) {
    return {
      ok: false,
      message: "Python venv не найден. cd bot && python -m venv .venv && pip install -r requirements.txt",
    };
  }

  try {
    spawnLock = true;
    const logFd = fs.openSync(LOG_FILE, "a");
    fs.writeSync(logFd, `\n--- ${cfg.label} ${new Date().toISOString()} ---\n`);

    const child = spawn(pythonCmd, cfg.args, {
      cwd: BOT_DIR,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    activeChild = child;

    const state: MaintenanceJobState = {
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
      const done: MaintenanceJobState = {
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

    return { ok: true, message: `Запущено: ${cfg.label}`, job: state };
  } catch (e) {
    spawnLock = false;
    return { ok: false, message: e instanceof Error ? e.message : "Ошибка запуска" };
  }
}

export function getJobCatalog() {
  return Object.entries(JOB_CONFIG).map(([id, cfg]) => ({
    id: id as MaintenanceJobId,
    label: cfg.label,
    expectedMinutes: cfg.expectedMinutes,
  }));
}
