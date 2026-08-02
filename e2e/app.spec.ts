import { test, expect } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Интеллектуальные прогнозы")).toBeVisible();
  await expect(page.getByRole("button", { name: /Получить AI-прогноз/i })).toBeVisible();
});

test("coin selector opens dialog", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Выбрать криптовалюту").click();
  await expect(page.getByText("Выберите криптовалюту")).toBeVisible();
});

test("api coins returns list", async ({ request }) => {
  const response = await request.get("/api/coins");
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data.coins?.length).toBeGreaterThan(0);
});
