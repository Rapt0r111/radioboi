import { expect, test } from "@playwright/test";
import { makeCoordinate } from "@radioboi/game-core";
import { emitServerEvent, installFakeGameServer } from "./helpers/fake-game-server";

test.beforeEach(async ({ page }) => {
  await installFakeGameServer(page);
});

test("uses the stored nickname in the room connection and roster", async ({ page }) => {
  await page.addInitScript(() => {
    // Shared browser default (localStorage) — also works from a brand-new window.
    localStorage.setItem("radioboi:playerName", "Моряк");
  });

  await page.goto("/game/NICK01");
  await page.waitForFunction(() => window.__radioboiFakeServer.socketCount() === 1);

  const playerName = await page.evaluate(() => {
    const url = new URL(window.__radioboiFakeServer.urls.at(-1) ?? "");
    return url.searchParams.get("playerName");
  });
  expect(playerName).toBe("Моряк");

  // Pin into this tab's session for subsequent refreshes.
  const storage = await page.evaluate(() => ({
    playerId: sessionStorage.getItem("radioboi:playerId"),
    sessionName: sessionStorage.getItem("radioboi:playerName"),
    localName: localStorage.getItem("radioboi:playerName"),
  }));
  expect(storage.playerId).not.toBeNull();
  expect(storage.sessionName).toBe("Моряк");
  expect(storage.localName).toBe("Моряк");

  await emitServerEvent(page, {
    type: "SYNC_STATE",
    payload: {
      phase: "battle",
      ownBoard: {},
      enemyBoard: {},
      activeMissiles: [],
      isMyTurn: true,
      shotLog: [],
      players: [
        { id: storage.playerId ?? "local", name: "Моряк" },
        { id: "enemy", name: "Радио" },
      ],
    },
  });

  await expect(page.locator("body")).toContainText("Моряк");
  await expect(page.locator("body")).toContainText("Радио");
});

test("keeps the same playerId and nickname after a full page reload", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("radioboi:playerName", "Капитан");
  });

  await page.goto("/game/RELOAD1");
  await page.waitForFunction(() => window.__radioboiFakeServer.socketCount() === 1);

  const before = await page.evaluate(() => ({
    playerId: sessionStorage.getItem("radioboi:playerId"),
    playerName: new URL(window.__radioboiFakeServer.urls.at(-1) ?? "").searchParams.get("playerName"),
    windowName: window.name,
  }));
  expect(before.playerId).not.toBeNull();
  expect(before.playerName).toBe("Капитан");
  expect(before.windowName.startsWith("radioboi-tab:")).toBe(true);

  await page.reload();
  await page.waitForFunction(() => window.__radioboiFakeServer.socketCount() >= 1);

  const after = await page.evaluate(() => ({
    playerId: sessionStorage.getItem("radioboi:playerId"),
    playerName: new URL(window.__radioboiFakeServer.urls.at(-1) ?? "").searchParams.get("playerName"),
    windowName: window.name,
  }));
  expect(after.playerId).toBe(before.playerId);
  expect(after.playerName).toBe("Капитан");
  expect(after.windowName).toBe(before.windowName);
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

test("expert mode requires manual coordinates and hides input hints", async ({ page }) => {
  const roomId = "EXPERT1";
  await page.addInitScript((id) => {
    sessionStorage.setItem(
      `radioboi:settings:${id}`,
      JSON.stringify({
        battleMode: "turn-based",
        difficulty: "expert",
        attackCooldownMs: 2000,
        interceptWindowMs: 25000,
        maxInterceptAttempts: 3,
      }),
    );
  }, roomId);

  await page.goto(`/game/${roomId}`);
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
      settings: {
        battleMode: "turn-based",
        difficulty: "expert",
        attackCooldownMs: 2000,
        interceptWindowMs: 25000,
        maxInterceptAttempts: 3,
      },
    },
  });

  const firstEnemyCell = page.locator("table").first().locator("button").first();
  await expect(firstEnemyCell).toBeDisabled();
  await expect(page.locator("body")).not.toContainText("мс/ед");
  await expect(page.locator("body")).not.toContainText("Выберите цель на поле противника");
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

test("telegraph keeps a symbol open for the selected pause between presses", async ({ page }) => {
  await page.goto("/game/GAP100");
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

  const telegraphKey = page.locator('button:has-text("PRESS TO KEY")');
  const telegraph = telegraphKey.locator("xpath=ancestor::section[@aria-label]");
  const liveSymbols = telegraph.getByTestId("morse-live-symbols");
  const gapSlider = page.locator("#ctrl-symbol-gap");

  await expect(gapSlider).toHaveValue("500");
  await gapSlider.focus();
  for (let i = 0; i < 10; i += 1) {
    await gapSlider.press("ArrowRight");
  }
  await expect(gapSlider).toHaveValue("1000");
  await expect(telegraph).toContainText("пауза ≤ 1000мс");

  const box = await telegraphKey.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();

  await page.waitForTimeout(700);
  await expect(liveSymbols).toHaveText(/^[.-]$/);

  await page.waitForTimeout(350);
  await expect(liveSymbols).toHaveText("READY");
});

test("async room starts without turn or intercept gating and keeps miss markers", async ({
  page,
}) => {
  const roomId = "ASYNC1";
  const target = makeCoordinate(0, 0);
  await page.addInitScript((id) => {
    sessionStorage.setItem(
      `radioboi:settings:${id}`,
      JSON.stringify({
        battleMode: "async",
        difficulty: "normal",
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
        difficulty: "normal",
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

test("resolved smoke, fire, and splash effects remain visible after the impact sound window", async ({
  page,
}) => {
  const roomId = "PERSIST1";
  const hitTarget = makeCoordinate(0, 0);
  const missTarget = makeCoordinate(1, 0);
  const sunkTarget = makeCoordinate(2, 0);

  await page.addInitScript((id) => {
    sessionStorage.setItem(
      `radioboi:settings:${id}`,
      JSON.stringify({
        battleMode: "async",
        difficulty: "normal",
        attackCooldownMs: 2000,
        interceptWindowMs: 25000,
        maxInterceptAttempts: 3,
      }),
    );
  }, roomId);

  await page.goto(`/game/${roomId}`);
  await page.waitForFunction(() => window.__radioboiFakeServer.socketCount() === 1);

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
        difficulty: "normal",
        attackCooldownMs: 2000,
        interceptWindowMs: 25000,
        maxInterceptAttempts: 3,
      },
      attackCooldownExpiresAt: 0,
    },
  });

  const enemyBoard = page.locator('table[aria-label="Поле противника"]');
  await expect(enemyBoard.locator(`button[data-coord="${hitTarget}"]`)).toBeEnabled();

  const playerId = await page.evaluate(() => sessionStorage.getItem("radioboi:playerId"));
  expect(playerId).not.toBeNull();

  const hitSmoke = enemyBoard.locator(`button[data-coord="${hitTarget}"] .battle-cell-vfx--hit`);
  const splash = enemyBoard.locator(`button[data-coord="${missTarget}"] .battle-cell-vfx--miss`);
  const sunkFire = enemyBoard.locator(`button[data-coord="${sunkTarget}"] .battle-cell-vfx--sunk`);

  await emitServerEvent(page, {
    type: "RESOLVE_HIT",
    payload: {
      missileId: "persist-hit",
      attackerId: playerId,
      target: hitTarget,
      result: "hit",
      nextTurnPlayerId: "",
      isGameOver: false,
      wasIntercepted: false,
    },
  });
  await expect(hitSmoke).toBeVisible();

  await emitServerEvent(page, {
    type: "RESOLVE_HIT",
    payload: {
      missileId: "persist-miss",
      attackerId: playerId,
      target: missTarget,
      result: "miss",
      nextTurnPlayerId: "",
      isGameOver: false,
      wasIntercepted: false,
    },
  });
  await expect(splash).toBeVisible();

  await emitServerEvent(page, {
    type: "RESOLVE_HIT",
    payload: {
      missileId: "persist-sunk",
      attackerId: playerId,
      target: sunkTarget,
      result: "sunk",
      nextTurnPlayerId: "",
      isGameOver: false,
      wasIntercepted: false,
    },
  });
  await expect(sunkFire).toBeVisible();
  await expect(hitSmoke.locator(".battle-smoke")).toHaveCount(4);
  await expect(hitSmoke.locator(".battle-flame")).toHaveCount(0);
  await expect(sunkFire.locator(".battle-flame")).toHaveCount(3);
  await page.waitForTimeout(2_200);

  await expect(hitSmoke).toHaveCSS("opacity", "1");
  await expect(splash).toHaveCSS("opacity", "1");
  await expect(sunkFire).toHaveCSS("opacity", "1");
  await expect(hitSmoke.locator(".battle-smoke").first()).toHaveCSS(
    "animation-iteration-count",
    "infinite",
  );
  await expect(splash.locator(".battle-splash").first()).toHaveCSS(
    "animation-iteration-count",
    "infinite",
  );
  await expect(sunkFire.locator(".battle-flame").first()).toHaveCSS(
    "animation-iteration-count",
    "infinite",
  );
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
        difficulty: "normal",
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
  await expect(page.locator("body")).toContainText("История сигналов");
  await expect(page.locator("body")).toContainText("75%");
  await expect(page.locator("body")).toContainText("67%");
  await expect(page.getByTestId("shot-timeline-row")).toHaveCount(12);

  await expect(page.getByRole("link", { name: "Новый бой" })).toBeVisible();
});
