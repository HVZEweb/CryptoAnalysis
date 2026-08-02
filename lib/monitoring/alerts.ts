/**
 * Production alerts — drift, sharp drop, regime shift + webhook dispatch.
 */

import fs from "fs/promises";
import path from "path";
import {
  detectConceptDrift,
  DRIFT_DROP_THRESHOLD,
  DRIFT_MIN_SAMPLES,
  getMonitorRecords,
} from "@/lib/monitoring/prediction-monitor";
import type { DriftAlert, MonitoringAlert, MonitoringAlertKind, MonitoredPrediction } from "@/lib/monitoring/types";

const ALERTS_PATH = path.join(process.cwd(), ".cache", "prediction-monitor", "alerts-store.json");
const DEDUP_MS = 24 * 60 * 60_000;

interface AlertsStore {
  updatedAt: string;
  active: MonitoringAlert[];
  history: MonitoringAlert[];
}

function isAccurate(record: MonitoredPrediction): boolean {
  return (
    record.outcome?.timeframePhase === "completed" && (record.outcome?.score ?? 0) >= 72
  );
}

function filterWindow(
  records: MonitoredPrediction[],
  startDaysAgo: number,
  endDaysAgo: number,
  inclusiveEnd = true
) {
  const now = Date.now();
  const day = 24 * 60 * 60_000;
  const lo = now - Math.max(startDaysAgo, endDaysAgo) * day;
  const hi = now - Math.min(startDaysAgo, endDaysAgo) * day;
  return records.filter((r) => {
    const t = new Date(r.recordedAt).getTime();
    return inclusiveEnd ? t >= lo && t <= hi : t >= lo && t < hi;
  });
}

function segmentAccuracy(records: MonitoredPrediction[]): number {
  const completed = records.filter((r) => r.outcome?.timeframePhase === "completed");
  if (!completed.length) return 0;
  return completed.filter(isAccurate).length / completed.length;
}

export function detectSharpDropAlerts(records: MonitoredPrediction[]): MonitoringAlert[] {
  const recent = filterWindow(records, 7, 0);
  const prior = filterWindow(records, 14, 7, false);
  const recentAcc = segmentAccuracy(recent);
  const priorAcc = segmentAccuracy(prior);

  if (recent.filter((r) => r.outcome?.timeframePhase === "completed").length < DRIFT_MIN_SAMPLES) {
    return [];
  }
  if (prior.filter((r) => r.outcome?.timeframePhase === "completed").length < DRIFT_MIN_SAMPLES) {
    return [];
  }

  const drop = priorAcc - recentAcc;
  if (drop < DRIFT_DROP_THRESHOLD) return [];

  return [
    {
      id: `sharp-${Date.now()}`,
      kind: "sharp_drop",
      severity: drop >= DRIFT_DROP_THRESHOLD * 1.5 ? "critical" : "warning",
      title: "Sharp accuracy drop (7d)",
      message: `Accuracy fell from ${(priorAcc * 100).toFixed(0)}% to ${(recentAcc * 100).toFixed(0)}% (−${(drop * 100).toFixed(0)}%) in the last week.`,
      dimension: "overall",
      key: "7d",
      createdAt: new Date().toISOString(),
      dispatched: false,
      channels: [],
    },
  ];
}

export function detectRegimeShiftAlerts(records: MonitoredPrediction[]): MonitoringAlert[] {
  const recent = filterWindow(records, 14, 0).filter((r) => r.regime);
  const baseline = filterWindow(records, 74, 14).filter((r) => r.regime);

  if (recent.length < 10 || baseline.length < 20) return [];

  const share = (list: MonitoredPrediction[]) => {
    const counts = new Map<string, number>();
    for (const r of list) {
      const k = r.regime!;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const total = list.length;
    const out = new Map<string, number>();
    for (const [k, v] of counts) out.set(k, v / total);
    return out;
  };

  const recentShare = share(recent);
  const baseShare = share(baseline);
  const alerts: MonitoringAlert[] = [];

  for (const [regime, rShare] of recentShare) {
    const bShare = baseShare.get(regime) ?? 0;
    const delta = Math.abs(rShare - bShare);
    if (delta < 0.2) continue;

    alerts.push({
      id: `regime-shift-${regime}-${Date.now()}`,
      kind: "regime_shift",
      severity: delta >= 0.35 ? "critical" : "warning",
      title: `Regime shift: ${regime}`,
      message: `Share of "${regime}" moved from ${(bShare * 100).toFixed(0)}% → ${(rShare * 100).toFixed(0)}% (Δ ${(delta * 100).toFixed(0)}pp).`,
      dimension: "regime",
      key: regime,
      createdAt: new Date().toISOString(),
      dispatched: false,
      channels: [],
    });
  }

  return alerts;
}

function driftToMonitoringAlert(d: DriftAlert): MonitoringAlert {
  return {
    id: `drift-${d.dimension}-${d.key}-${Date.now()}`,
    kind: "drift",
    severity: d.severity,
    title: `Concept drift: ${d.label}`,
    message: `Accuracy ${(d.baselineAccuracy * 100).toFixed(0)}% → ${(d.recentAccuracy * 100).toFixed(0)}% (−${(d.dropPct * 100).toFixed(0)}%). Baseline n=${d.baselineSamples}, recent n=${d.recentSamples}.`,
    dimension: d.dimension,
    key: d.key,
    createdAt: new Date().toISOString(),
    dispatched: false,
    channels: [],
  };
}

export async function collectMonitoringAlerts(): Promise<MonitoringAlert[]> {
  const records = await getMonitorRecords();
  const drift = detectConceptDrift(records).map(driftToMonitoringAlert);
  const sharp = detectSharpDropAlerts(records);
  const regime = detectRegimeShiftAlerts(records);

  return [...drift, ...sharp, ...regime].sort(
    (a, b) => (a.severity === "critical" ? -1 : 1) - (b.severity === "critical" ? -1 : 1)
  );
}

async function loadAlertsStore(): Promise<AlertsStore> {
  try {
    const raw = await fs.readFile(ALERTS_PATH, "utf-8");
    return JSON.parse(raw) as AlertsStore;
  } catch {
    return { updatedAt: new Date(0).toISOString(), active: [], history: [] };
  }
}

async function saveAlertsStore(store: AlertsStore): Promise<void> {
  await fs.mkdir(path.dirname(ALERTS_PATH), { recursive: true });
  store.updatedAt = new Date().toISOString();
  await fs.writeFile(ALERTS_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function alertDedupKey(a: MonitoringAlert): string {
  return `${a.kind}:${a.dimension ?? ""}:${a.key ?? ""}`;
}

function isDuplicate(alert: MonitoringAlert, history: MonitoringAlert[]): boolean {
  const key = alertDedupKey(alert);
  const cutoff = Date.now() - DEDUP_MS;
  return history.some(
    (h) => alertDedupKey(h) === key && new Date(h.createdAt).getTime() >= cutoff
  );
}

export interface WebhookConfig {
  enabled: boolean;
  discord?: string;
  telegramBot?: string;
  telegramChat?: string;
  email?: string;
}

export function getWebhookConfig(): WebhookConfig {
  return {
    enabled: process.env.MONITORING_ALERTS_ENABLED === "true",
    discord: process.env.MONITORING_DISCORD_WEBHOOK_URL,
    telegramBot: process.env.MONITORING_TELEGRAM_BOT_TOKEN,
    telegramChat: process.env.MONITORING_TELEGRAM_CHAT_ID,
    email: process.env.MONITORING_EMAIL_WEBHOOK_URL,
  };
}

async function postJson(url: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function dispatchAlert(alert: MonitoringAlert): Promise<string[]> {
  const config = getWebhookConfig();
  if (!config.enabled) return [];

  const sent: string[] = [];
  const text = `**${alert.title}**\n${alert.message}\n_${alert.kind} · ${alert.severity}_`;

  if (config.discord) {
    const ok = await postJson(config.discord, { content: text });
    if (ok) sent.push("discord");
  }

  if (config.telegramBot && config.telegramChat) {
    const url = `https://api.telegram.org/bot${config.telegramBot}/sendMessage`;
    const ok = await postJson(url, {
      chat_id: config.telegramChat,
      text: `${alert.title}\n${alert.message}`,
      parse_mode: "HTML",
    });
    if (ok) sent.push("telegram");
  }

  if (config.email) {
    const ok = await postJson(config.email, {
      subject: `[Crypto Predictor] ${alert.title}`,
      title: alert.title,
      message: alert.message,
      kind: alert.kind,
      severity: alert.severity,
    });
    if (ok) sent.push("email");
  }

  return sent;
}

export async function processAndDispatchAlerts(): Promise<{
  active: MonitoringAlert[];
  dispatched: number;
  config: WebhookConfig;
}> {
  const collected = await collectMonitoringAlerts();
  const store = await loadAlertsStore();
  const toDispatch: MonitoringAlert[] = [];

  for (const alert of collected) {
    if (isDuplicate(alert, store.history)) continue;
    const channels = await dispatchAlert(alert);
    alert.dispatched = channels.length > 0;
    alert.channels = channels;
    toDispatch.push(alert);
    store.history.unshift(alert);
  }

  store.active = collected;
  store.history = store.history.slice(0, 100);
  await saveAlertsStore(store);

  return {
    active: collected,
    dispatched: toDispatch.filter((a) => a.dispatched).length,
    config: getWebhookConfig(),
  };
}

export async function getAlertsReport(): Promise<{
  active: MonitoringAlert[];
  history: MonitoringAlert[];
  config: WebhookConfig;
  updatedAt: string;
}> {
  const store = await loadAlertsStore();
  const active = store.active.length ? store.active : await collectMonitoringAlerts();

  return {
    active,
    history: store.history.slice(0, 20),
    config: getWebhookConfig(),
    updatedAt: store.updatedAt,
  };
}

export function alertKindLabel(kind: MonitoringAlertKind): string {
  switch (kind) {
    case "drift":
      return "Concept Drift";
    case "sharp_drop":
      return "Sharp Drop";
    case "regime_shift":
      return "Regime Shift";
  }
}
