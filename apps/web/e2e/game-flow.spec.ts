import { expect, test } from "@playwright/test";
import { installFakeGameServer, emitServerEvent } from "./helpers/fake-game-server";

test.beforeEach(async ({ page }) => {
  await installFakeGameServer(page);
});

test("game page connects, enters placement, and submits a ready fleet", async ({ page }) => {
  await page.goto("/game/E2E123");
  await page.waitForFunction(() => window.__radioboiFakeServer.socketCount() === 1);
  await expect
    .poll(() => page.evaluate(() => window.__radioboiFakeServer.sent.length))
    .toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(250);

  await expect(page.locator("body")).toContainText("E2E123");

  await emitServerEvent(page, {
    type: "SYNC_STATE",
    payload: {
      phase: "placement",
      ownBoard: {},
      enemyBoard: {},
      activeMissiles: [],
      isMyTurn: false,
      shotLog: [],
    },
  });

  await expect(page.locator("[data-coord]")).toHaveCount(200);

  const readyButton = page.locator('button:has-text("10/10")');
  await expect(readyButton).toBeEnabled();
  await readyButton.click();

  await expect
    .poll(() => page.evaluate(() => window.__radioboiFakeServer.sent.length))
    .toBeGreaterThanOrEqual(2);
  await expect(page.locator("body")).toContainText("SECURE CHANNEL");
});

test("battle phase lets the active player select an enemy target", async ({ page }) => {
  await page.goto("/game/E2E999");
  await page.waitForFunction(() => window.__radioboiFakeServer.socketCount() === 1);
  await expect
    .poll(() => page.evaluate(() => window.__radioboiFakeServer.sent.length))
    .toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(250);

  await emitServerEvent(page, {
    type: "SYNC_STATE",
    payload: {
      phase: "battle",
      ownBoard: {},
      enemyBoard: {},
      activeMissiles: [],
      isMyTurn: true,
      shotLog: [],
    },
  });

  await expect(page.locator("body")).toContainText("ROOM E2E999");
  await expect(page.locator('button:has-text("PRESS TO KEY")')).toBeVisible();

  const firstEnemyCell = page.locator("table").first().locator("button").first();
  await firstEnemyCell.click();

  await expect(firstEnemyCell).toHaveAttribute("aria-pressed", "true");
});
