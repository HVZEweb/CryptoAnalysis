import { describe, expect, it, vi } from "vitest";

// The stream reads one Binance futures ticker per symbol; CI runners can't reach Binance.
const tickerGet = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: { lastPrice: "65000", priceChangePercent: "2.1" } })
);
vi.mock("@/lib/axios", () => ({ binanceFuturesClient: { get: tickerGet } }));

import { GET } from "@/app/api/stream/prices/route";

describe("SSE prices stream", () => {
  it("returns event-stream content type", async () => {
    const controller = new AbortController();
    const response = await GET(new Request("http://localhost/api/stream/prices", { signal: controller.signal }));
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.body).toBeTruthy();

    const reader = response.body!.getReader();
    const { value } = await reader.read();
    controller.abort();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toContain("data:");
    expect(chunk).toContain("quotes");
    expect(chunk).toContain("65000");
    // one ticker call per symbol, nothing else
    expect(tickerGet).toHaveBeenCalledTimes(3);
    expect(tickerGet).toHaveBeenCalledWith("/ticker/24hr", expect.objectContaining({ params: { symbol: "BTCUSDT" } }));
  });
});
