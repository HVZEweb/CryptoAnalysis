import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/binance", () => ({
  fetchMarketData: vi.fn().mockResolvedValue({
    price: 65_000,
    priceChangePercent24h: 2.1,
  }),
}));

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
  });
});
