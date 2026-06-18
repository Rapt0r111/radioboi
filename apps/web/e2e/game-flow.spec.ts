import { expect, test } from "@playwright/test";
import { makeCoordinate } from "@radioboi/game-core";
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

test("telegraph prevents repeated Space keydown from scrolling during battle", async ({ page }) => {
  await page.goto("/game/SPACE1");
  await page.waitForFunction(() => window.__radioboiFakeServer.socketCount() === 1);

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

  await expect(page.locator('button:has-text("PRESS TO KEY")')).toBeVisible();

  const wasPrevented = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Space",
      key: " ",
      repeat: true,
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

  expect(wasPrevented).toBe(true);
});

test("async room starts without turn or intercept gating and keeps miss markers", async ({ page }) => {
  const roomId = "ASYNC1";
  const target = makeCoordinate(0, 0);
  await page.addInitScript((id) => {
    sessionStorage.setItem(
      `radioboi:settings:${id}`,
      JSON.stringify({
        battleMode: "async",
        attackCooldownMs: 2000,
        interceptWindowMs: 25000,
        maxInterceptAttempts: 3,
      }),
    );
  }, roomId);

  await page.goto(`/game/${roomId}`);
  await page.waitForFunction(() => window.__radioboiFakeServer.socketCount() === 1);

  const settingsParam = await page.evaluate(() => {
    const url = new URL(window.__radioboiFakeServer.urls.at(-1) ?? "");
    return JSON.parse(url.searchParams.get("settings") ?? "{}") as Record<string, unknown>;
  });
  expect(settingsParam.battleMode).toBe("async");
  expect(settingsParam.attackCooldownMs).toBe(2000);

  await emitServerEvent(page, {
    type: "GAME_STARTED",
    payload: { firstTurnPlayerId: "" },
  });

  await emitServerEvent(page, {
    type: "SYNC_STATE",
    payload: {
      phase: "battle",
      ownBoard: {},
      enemyBoard: {},
      activeMissiles: [],
      isMyTurn: false,
      shotLog: [],
      settings: {
        battleMode: "async",
        attackCooldownMs: 2000,
        interceptWindowMs: 25000,
        maxInterceptAttempts: 3,
      },
      attackCooldownExpiresAt: 0,
    },
  });

  const firstEnemyCell = page.locator("table").first().locator(`button[data-coord="${target}"]`);
  await expect(firstEnemyCell).toBeEnabled();

  const playerId = await page.evaluate(() => sessionStorage.getItem("radioboi:playerId"));
  expect(playerId).not.toBeNull();

  await emitServerEvent(page, {
    type: "RESOLVE_HIT",
    payload: {
      missileId: "m-async-miss",
      attackerId: playerId,
      target,
      result: "miss",
      nextTurnPlayerId: "",
      isGameOver: false,
      wasIntercepted: false,
    },
  });

  await expect(firstEnemyCell).toHaveText("·");
  await expect(firstEnemyCell).toBeDisabled();
});

test("game over page renders the detailed battle report", async ({ page }) => {
  await page.goto("/game/STAT99");
  await page.waitForFunction(() => window.__radioboiFakeServer.socketCount() >= 1);

  const playerId = await page.evaluate(() => sessionStorage.getItem("radioboi:playerId"));
  expect(playerId).not.toBeNull();

  await emitServerEvent(page, {
    type: "SYNC_STATE",
    payload: {
      phase: "gameOver",
      ownBoard: {
        [makeCoordinate(0, 0)]: "ship",
        [makeCoordinate(1, 0)]: "hit",
        [makeCoordinate(2, 0)]: "sunk",
        [makeCoordinate(3, 0)]: "miss",
      },
      enemyBoard: {
        [makeCoordinate(0, 0)]: "sunk",
        [makeCoordinate(1, 0)]: "sunk",
        [makeCoordinate(2, 0)]: "hit",
        [makeCoordinate(3, 0)]: "miss",
        [makeCoordinate(4, 0)]: "blocked",
      },
      activeMissiles: [],
      isMyTurn: false,
      winnerId: playerId,
      shotLog: [
        { by: "us", coord: "А1", result: "hit", ts: 1_000 },
        { by: "them", coord: "Б2", result: "miss", ts: 7_000 },
        { by: "us", coord: "А2", result: "sunk", ts: 16_000 },
        { by: "them", coord: "В3", result: "hit", ts: 29_000 },
        { by: "us", coord: "А3", result: "hit", ts: 38_000 },
        { by: "us", coord: "А4", result: "miss", ts: 50_000 },
        { by: "them", coord: "Г4", result: "miss", ts: 55_000 },
        { by: "us", coord: "А5", result: "hit", ts: 60_000 },
        { by: "us", coord: "А6", result: "hit", ts: 65_000 },
        { by: "them", coord: "Д5", result: "hit", ts: 70_000 },
        { by: "us", coord: "А7", result: "miss", ts: 75_000 },
        { by: "us", coord: "А8", result: "sunk", ts: 80_000 },
      ],
      settings: {
        battleMode: "async",
        attackCooldownMs: 2000,
        interceptWindowMs: 25000,
        maxInterceptAttempts: 3,
      },
      attackCooldownExpiresAt: 0,
    },
  });

  await expect(page.getByRole("heading", { name: "Победа" })).toBeVisible();
  await expect(page.locator("body")).toContainText("Огонь по противнику");
  await expect(page.locator("body")).toContainText("Финальная карта боя");
  await expect(page.locator("body")).toContainText("Общая статистика");
  await expect(page.locator("body")).toContainText("Последние сигналы");
  await expect(page.locator("body")).toContainText("75%");
  await expect(page.locator("body")).toContainText("67%");
  await expect(page.getByTestId("shot-timeline-row")).toHaveCount(12);

  await expect(page.getByRole("link", { name: "Новый бой" })).toBeVisible();
});
