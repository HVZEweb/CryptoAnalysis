export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installOutboundProxy } = await import("@/lib/outbound-proxy");
    await installOutboundProxy();
  }
}
