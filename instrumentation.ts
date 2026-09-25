export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { installOutboundProxy } = await import("@/lib/outbound-proxy");
  await installOutboundProxy();

  // Check finished predictions against real prices every 5 minutes, so the site's accuracy
  // numbers stay current without anyone opening the monitoring page.
  if (process.env.MONITOR_AUTO_REFRESH !== "false") {
    const { refreshOutcomes } = await import("@/lib/monitoring/prediction-monitor");
    const timer = setInterval(() => {
      refreshOutcomes(40).catch((e) => console.warn("[monitor] outcome refresh failed:", (e as Error).message));
    }, 5 * 60_000);
    timer.unref();
  }
}
