import { describe, expect, it } from "vitest";
import { z } from "zod";

const authSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(8, "Минимум 8 символов"),
});

describe("auth validation", () => {
  it("rejects short password", () => {
    const result = authSchema.safeParse({ email: "user@example.com", password: "1234567" });
    expect(result.success).toBe(false);
  });

  it("accepts valid credentials", () => {
    const result = authSchema.safeParse({ email: "user@example.com", password: "12345678" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = authSchema.safeParse({ email: "not-email", password: "12345678" });
    expect(result.success).toBe(false);
  });
});
