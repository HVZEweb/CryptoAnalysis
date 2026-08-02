import { describe, expect, it } from "vitest";
import axios from "axios";
import { normalizeOpenRouterError } from "@/services/openrouter";

describe("normalizeOpenRouterError", () => {
  it("maps axios 402 to readable OpenRouter/OmniRoute message", () => {
    const error = new axios.AxiosError(
      "Request failed with status code 402",
      "ERR_BAD_REQUEST",
      undefined,
      undefined,
      {
        status: 402,
        statusText: "Payment Required",
        headers: {},
        config: { headers: new axios.AxiosHeaders() },
        data: { error: { message: "Insufficient credits" } },
      }
    );

    const normalized = normalizeOpenRouterError(error);
    expect(normalized.code).toBe("OPENROUTER_ERROR");
    expect(normalized.message).toContain("402");
    expect(normalized.message).not.toBe("Request failed with status code 402");
  });

  it("does not treat axios errors as ApiError via ERR_BAD_REQUEST code", () => {
    const error = new axios.AxiosError(
      "Request failed with status code 500",
      "ERR_BAD_RESPONSE",
      undefined,
      undefined,
      {
        status: 500,
        statusText: "Internal Server Error",
        headers: {},
        config: { headers: new axios.AxiosHeaders() },
        data: {},
      }
    );

    const normalized = normalizeOpenRouterError(error);
    expect(normalized.code).toBe("OPENROUTER_ERROR");
  });
});
