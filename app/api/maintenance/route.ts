import { NextResponse } from "next/server";
import {
  getJobCatalog,
  getMaintenanceJob,
  readMaintenanceLogTail,
  startMaintenanceJob,
  type MaintenanceJobId,
} from "@/lib/maintenance-process";
import {
  getLatestReport,
  listReports,
  readArchiveLast,
  readCoverageLast,
  readDataManifest,
  readReportJson,
  summarizePhaseX,
} from "@/lib/maintenance-reports";

const VALID_JOBS = new Set<MaintenanceJobId>(["archive", "archive-l2", "coverage", "phase-x"]);

export async function GET() {
  const manifest = readDataManifest();
  const coverageLast = readCoverageLast();
  const archiveLast = readArchiveLast();
  const reports = listReports();
  const latestPhaseX = getLatestReport("phase_x");
  const latestCoverage = getLatestReport("coverage");

  let phaseXSummary = null;
  if (latestPhaseX) {
    const data = readReportJson(latestPhaseX.id);
    if (data) phaseXSummary = summarizePhaseX(data);
  }

  const datasets = (manifest?.datasets as Record<string, Record<string, unknown>>) || {};
  const fundingSpans = Object.entries(datasets)
    .filter(([k]) => k.endsWith("_funding"))
    .map(([, v]) => Number(v.span_days) || 0);
  const oiSpans = Object.entries(datasets)
    .filter(([k]) => k.endsWith("_oi_5m"))
    .map(([, v]) => Number(v.span_days) || 0);

  const maxFundingDays = fundingSpans.length ? Math.max(...fundingSpans) : 0;
  const maxOiDays = oiSpans.length ? Math.max(...oiSpans) : 0;

  return NextResponse.json({
    job: getMaintenanceJob(),
    jobCatalog: getJobCatalog(),
    logTail: readMaintenanceLogTail(40),
    manifest,
    coverageLast: coverageLast?.summary || null,
    archiveLast,
    reports: reports.slice(0, 30),
    latestPhaseX: latestPhaseX || null,
    latestCoverage: latestCoverage || null,
    phaseXSummary,
    milestones: {
      fundingDays: { current: maxFundingDays, target: 30, met: maxFundingDays >= 30 },
      oiDays: { current: maxOiDays, target: 7, met: maxOiDays >= 7 },
      lastArchiveRun: (manifest?.last_archive_run as string) || null,
    },
    baseline: {
      date: "2026-07-11",
      accepted: 0,
      note: "Воспроизводимый edge не обнаружен. Ожидаем накопление данных.",
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

  const jobId = body.job as MaintenanceJobId;
  if (!jobId || !VALID_JOBS.has(jobId)) {
    return NextResponse.json({ error: "Unknown job" }, { status: 400 });
  }

  const result = startMaintenanceJob(jobId);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
