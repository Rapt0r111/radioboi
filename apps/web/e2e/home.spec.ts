import { expect, test } from "@playwright/test";

test("home page exposes the lobby form and security headers", async ({ page, request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["referrer-policy"]).toBe("same-origin");

  await page.goto("/");

  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const playerNameInput = page.locator('input[name="playerName"]');
  await expect(playerNameInput).toBeVisible();
  await expect(playerNameInput).toHaveAttribute("maxlength", "24");
  await playerNameInput.fill("Моряк");
  await expect(playerNameInput).toHaveValue("Моряк");

  const codeInput = page.locator('input[name="code"]');
  await expect(codeInput).toHaveAttribute("maxlength", "6");
  await codeInput.fill("ab-cd");
  await expect(codeInput).toHaveValue("ABCD");
});

test("home page prefills nickname from localStorage across windows", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("radioboi:playerName", "Моряк");
  });

  await page.goto("/");
  await expect(page.locator('input[name="playerName"]')).toHaveValue("Моряк");
});

test("home page renders server-side join errors", async ({ page }) => {
  await page.goto("/?error=Room%20not%20found");

  await expect(page.getByRole("alert").filter({ hasText: "Room not found" })).toBeVisible();
});
