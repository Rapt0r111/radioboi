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

  const codeInput = page.locator('input[name="code"]');
  await expect(codeInput).toHaveAttribute("maxlength", "6");
  await codeInput.fill("ab-cd");
  await expect(codeInput).toHaveValue("ABCD");
});

test("home page renders server-side join errors", async ({ page }) => {
  await page.goto("/?error=Room%20not%20found");

  await expect(page.getByRole("alert").filter({ hasText: "Room not found" })).toBeVisible();
});
