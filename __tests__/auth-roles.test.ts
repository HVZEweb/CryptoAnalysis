import { beforeAll, describe, expect, it } from "vitest";
import { execute } from "@/lib/db";
import { createUser, isSignupOpen, loginUser, registerUser, setUserRole } from "@/lib/auth";

// Touches real tables, so it only runs against a throwaway *_ci database (as in CI).
const onCiDb = (process.env.DB_NAME ?? "").endsWith("_ci");

describe.runIf(onCiDb)("single sign-in with roles", () => {
  beforeAll(async () => {
    await execute("DELETE FROM sessions");
    await execute("DELETE FROM users");
  });

  it("makes the first account the admin and later ones plain users", async () => {
    const first = await registerUser("owner@example.com", "password1");
    const second = await createUser("member@example.com", "password2");
    expect(first.user.role).toBe("admin");
    expect(second.role).toBe("user");
    expect((await loginUser("member@example.com", "password2")).user.role).toBe("user");
  });

  it("never removes the last admin", async () => {
    const admin = (await loginUser("owner@example.com", "password1")).user;
    expect(await setUserRole(admin.id, "user")).toBe("last_admin");
  });

  it("closes signup on a private site once someone exists", async () => {
    process.env.SITE_PRIVATE = "true";
    expect(await isSignupOpen()).toBe(false);
    process.env.ALLOW_SIGNUP = "true";
    expect(await isSignupOpen()).toBe(true);
    delete process.env.ALLOW_SIGNUP;
    delete process.env.SITE_PRIVATE;
    expect(await isSignupOpen()).toBe(true);
  });
});
