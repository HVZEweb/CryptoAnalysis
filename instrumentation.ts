export async function register() {
  // Written exactly this way so Next.js drops the Node-only imports from the edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
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

    // Run the models on fresh candles and send validated trades to Telegram (no-op until a bot is connected).
    if (process.env.SIGNAL_SCANNER !== "false") {
      const { scanSignals } = await import("@/services/signal-scanner");
      const scan = () =>
        scanSignals()
          .then((r) => r.errors.length && console.warn("[signals]", r.errors.slice(0, 3).join("; ")))
          .catch((e) => console.warn("[signals] scan failed:", (e as Error).message));
      const timer = setInterval(scan, 5 * 60_000);
      timer.unref();

      // Commands from the connected chat (/watch, /list, /stats …); idle until a bot is connected.
      const { startBot } = await import("@/services/signals/bot");
      startBot();
    }
  }
}
