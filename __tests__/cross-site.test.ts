import { describe, expect, it } from "vitest";
import { isCrossSiteWrite } from "@/lib/request-context";

const req = (method: string, headers: Record<string, string>) =>
  new Request("http://127.0.0.1:3101/api/x", { method, headers: { host: "127.0.0.1:3101", ...headers } });

describe("cross-site write guard", () => {
  it("lets the site's own pages and non-browser clients change things", () => {
    expect(isCrossSiteWrite(req("POST", { origin: "https://cryptopredict.mywire.org", "x-forwarded-host": "cryptopredict.mywire.org" }))).toBe(false);
    expect(isCrossSiteWrite(req("POST", { "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSiteWrite(req("POST", {}))).toBe(false);
    expect(isCrossSiteWrite(req("GET", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("refuses writes sent by another site's page", () => {
    expect(isCrossSiteWrite(req("POST", { origin: "https://evil.example", "x-forwarded-host": "cryptopredict.mywire.org" }))).toBe(true);
    expect(isCrossSiteWrite(req("POST", { "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(isCrossSiteWrite(req("DELETE", { origin: "null" }))).toBe(true);
    expect(isCrossSiteWrite(req("POST", { origin: "https://cryptopredict.mywire.org.evil.example", "x-forwarded-host": "cryptopredict.mywire.org" }))).toBe(true);
  });
});
