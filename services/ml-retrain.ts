/**
 * Spawn scripts/ml-train.py on exported backtest training data.
 */

import fs from "fs";
import { spawn } from "child_process";
import path from "path";
import {
  TRAINING_JSONL_PATH,
  writeTrainingArrayForMl,
  type BacktestTrainingRecord,
} from "@/lib/backtesting/training-export";

const TRAIN_SCRIPT = path.join(process.cwd(), "scripts", "ml-train.py");
const DEFAULT_OUTPUT = path.join(process.cwd(), ".cache", "ml-weights.json");
const TRAIN_TIMEOUT_MS = 60_000;

export interface MlRetrainResult {
  ok: boolean;
  samples: number;
  outputPath: string;
  weightsPath?: string;
  error?: string;
}

function getPythonCmd(): string {
  if (process.env.PREDICTOR_PYTHON) return process.env.PREDICTOR_PYTHON;
  const win = path.join(process.cwd(), "bot", ".venv", "Scripts", "python.exe");
  const unix = path.join(process.cwd(), "bot", ".venv", "bin", "python");
  if (fs.existsSync(win)) return win;
  if (fs.existsSync(unix)) return unix;
  return "python";
}

export async function runMlRetrain(
  inputPath: string = TRAINING_JSONL_PATH,
  outputPath: string = DEFAULT_OUTPUT
): Promise<MlRetrainResult> {
  if (!fs.existsSync(inputPath)) {
    return { ok: false, samples: 0, outputPath, error: "training_file_not_found" };
  }

  let trainInput = inputPath;
  if (inputPath.endsWith(".jsonl")) {
    try {
      const raw = await fs.promises.readFile(inputPath, "utf-8");
      const records: BacktestTrainingRecord[] = raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l) as BacktestTrainingRecord);
      trainInput = await writeTrainingArrayForMl(records);
    } catch (e) {
      return {
        ok: false,
        samples: 0,
        outputPath,
        error: `jsonl_parse_failed: ${(e as Error).message}`,
      };
    }
  }

  return new Promise((resolve) => {
    const python = getPythonCmd();
    const child = spawn(python, [TRAIN_SCRIPT, "--input", trainInput, "--output", outputPath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: MlRetrainResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish({ ok: false, samples: 0, outputPath, error: "ml_train_timeout" });
    }, TRAIN_TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => finish({ ok: false, samples: 0, outputPath, error: err.message }));
    child.on("close", (code) => {
      if (code !== 0) {
        finish({
          ok: false,
          samples: 0,
          outputPath,
          error: stderr.slice(0, 300) || `exit_${code}`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { samples?: number; error?: string };
        if (parsed.error) {
          finish({ ok: false, samples: 0, outputPath, error: parsed.error });
          return;
        }
        finish({
          ok: true,
          samples: parsed.samples ?? 0,
          outputPath,
          weightsPath: outputPath,
        });
      } catch {
        finish({ ok: false, samples: 0, outputPath, error: "invalid_train_output" });
      }
    });
  });
}
