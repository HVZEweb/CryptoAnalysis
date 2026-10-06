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
      const { msToNextScan, scanSignals } = await import("@/services/signal-scanner");
      const scan = () =>
        scanSignals()
          .then((r) => r.errors.length && console.warn("[signals]", r.errors.slice(0, 3).join("; ")))
          .catch((e) => console.warn("[signals] scan failed:", (e as Error).message));
      // Aligned to bar closes (not every 5 minutes from whenever the site started), the next run
      // scheduled after the previous one has finished.
      const next = () => setTimeout(() => void scan().finally(next), msToNextScan()).unref();
      next();

      // Commands from the connected chat (/watch, /list, /stats …); idle until a bot is connected.
      const { startBot } = await import("@/services/signals/bot");
      startBot();
    }

    // New coins on OKX: announcements, profiles, first-week history (Telegram part is idle until a bot is connected).
    if (process.env.LISTINGS_MONITOR !== "false") {
      const { runListingsCycle } = await import("@/services/listings/monitor");
      let running = false;
      const cycle = () => {
        if (running) return; // a cycle with many first-week downloads can outlast the interval
        running = true;
        runListingsCycle()
          .then((r) => r.errors.length && console.warn("[listings]", r.errors.slice(0, 3).join("; ")))
          .catch((e) => console.warn("[listings] cycle failed:", (e as Error).message))
          .finally(() => (running = false));
      };
      setTimeout(cycle, 60_000).unref();
      setInterval(cycle, 5 * 60_000).unref();
    }

    // Funding forward test: a paper book updated after each daily close, rebalanced on Mondays (services/funding-carry).
    if (process.env.FUNDING_CARRY !== "false") {
      const { runCarryCycle } = await import("@/services/funding-carry/runner");
      let running = false;
      const cycle = () => {
        if (running) return;
        running = true;
        runCarryCycle()
          .catch((e) => console.warn("[carry] cycle failed:", (e as Error).message))
          .finally(() => (running = false));
      };
      setTimeout(cycle, 90_000).unref();
      setInterval(cycle, 60 * 60_000).unref();
    }

    // News monitoring runs all the time; strong news goes to the connected bot (/news off in the chat mutes it).
    if (process.env.NEWS_IMPACT_AUTO_START !== "false") {
      const { getNewsImpactEngine } = await import("@/services/news-impact/news-impact-engine");
      getNewsImpactEngine().catch((e) => console.warn("[news] start failed:", (e as Error).message));
    }
  }
}
