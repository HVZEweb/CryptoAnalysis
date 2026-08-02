import { NextResponse } from "next/server";
import {
  getMsbJob,
  getMsbJobCatalog,
  isCollectorLikelyRunning,
  readMsbLogTail,
  startMsbJob,
  type MsbJobId,
} from "@/lib/msb-process";
import {
  getDataMilestones,
  getHypothesisList,
  listMsbReports,
  readDailyReport,
  readWeeklyLatest,
  summarizeDaily,
  summarizeWeekly,
} from "@/lib/msb-reports";

const VALID_JOBS = new Set<MsbJobId>(["collect", "daily", "weekly", "status"]);

export async function GET() {
  const dailyRaw = readDailyReport();
  const weeklyRaw = readWeeklyLatest();
  const reports = listMsbReports();
  const job = getMsbJob();
  const collectorRunning = isCollectorLikelyRunning();

  return NextResponse.json({
    mode: "Continuous Research",
    job,
    jobCatalog: getMsbJobCatalog(),
    collectorRunning,
    logTail: readMsbLogTail(50),
    reports: reports.slice(0, 40),
    daily: dailyRaw ? summarizeDaily(dailyRaw) : null,
    weekly: weeklyRaw ? summarizeWeekly(weeklyRaw) : null,
    milestones: getDataMilestones(),
    hypotheses: getHypothesisList(),
    rules: {
      noParamChanges: true,
      noNewStrategies: true,
      dataOnly: true,
    },
  });
}

export async function POST(request: Request) {
  let body: { job?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const jobId = body.job as MsbJobId;
  if (!jobId || !VALID_JOBS.has(jobId)) {
    return NextResponse.json({ error: "Unknown job" }, { status: 400 });
  }

  const result = startMsbJob(jobId);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
