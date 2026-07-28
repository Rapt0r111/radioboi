import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_ROOM_SETTINGS, makeCoordinate } from "@radioboi/game-core";
import { formatCoordForLog, useGameStore } from "../src/store/gameStore";

describe("game store", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  test("resets session, boards, missiles, shot log, settings, and cooldown", () => {
    const coord = makeCoordinate(0, 0);
    const store = useGameStore.getState();

    store.setSession("p1", "room");
    store.placeShip([coord]);
    store.addMissile({ id: "m1", target: coord, launchedAt: 100 });
    store.addShotEntry({ by: "us", coord: "A1", result: "hit", ts: 1 });
    store.setAttackCooldown(Date.now() + 10_000);
    store.setPhase("battle");
    store.reset();

    expect(useGameStore.getState()).toMatchObject({
      phase: "lobby",
      playerId: null,
      roomId: null,
      ownBoard: {},
      enemyBoard: {},
      activeMissiles: [],
      isMyTurn: false,
      winnerId: null,
      shotLog: [],
      settings: DEFAULT_ROOM_SETTINGS,
      attackCooldownExpiresAt: null,
    });
  });

  test("applies local board mutations without leaking enemy ships", () => {
    const own = makeCoordinate(0, 0);
    const enemy = makeCoordinate(9, 9);
    const store = useGameStore.getState();

    store.placeShip([own]);
    store.applyOwnHit(own, "hit");
    store.applyEnemyShot(enemy, "miss");

    expect(useGameStore.getState().ownBoard[own]).toBe("hit");
    expect(useGameStore.getState().enemyBoard[enemy]).toBe("miss");
  });

  test("sync replaces server-owned state and preserves omitted optional fields", () => {
    const shotLog = [{ by: "them" as const, coord: "K10", result: "miss" as const, ts: 10 }];
    const settings = { ...DEFAULT_ROOM_SETTINGS, battleMode: "async" as const };

    useGameStore.getState().addShotEntry({ by: "us", coord: "A1", result: "hit", ts: 1 });
    useGameStore.getState().setAttackCooldown(Date.now() + 20_000);
    useGameStore.getState().syncFromServer({
      phase: "battle",
      ownBoard: {},
      enemyBoard: {},
      isMyTurn: true,
      winnerId: "p2",
      shotLog,
      settings,
      attackCooldownExpiresAt: 0,
    });

    expect(useGameStore.getState()).toMatchObject({
      phase: "battle",
      isMyTurn: true,
      winnerId: "p2",
      shotLog,
      settings,
      attackCooldownExpiresAt: null,
    });

    useGameStore.getState().syncFromServer({
      phase: "battle",
      ownBoard: {},
      enemyBoard: {},
      isMyTurn: false,
    });

    expect(useGameStore.getState().shotLog).toBe(shotLog);
    expect(useGameStore.getState().settings).toBe(settings);
  });

  test("deduplicates and removes local missiles while syncing server missiles", () => {
    const coord = makeCoordinate(0, 0);
    const missile = { id: "m1", target: coord, launchedAt: 100 };
    const store = useGameStore.getState();

    store.addMissile(missile);
    store.addMissile(missile);
    expect(useGameStore.getState().activeMissiles).toEqual([missile]);

    store.removeMissile(missile.id);
    expect(useGameStore.getState().activeMissiles).toEqual([]);

    store.syncFromServer({
      phase: "battle",
      ownBoard: {},
      enemyBoard: {},
      activeMissiles: [missile],
      isMyTurn: true,
    });
    expect(useGameStore.getState().activeMissiles).toEqual([missile]);

    store.syncFromServer({
      phase: "battle",
      ownBoard: {},
      enemyBoard: {},
      activeMissiles: [],
      isMyTurn: true,
    });
    expect(useGameStore.getState().activeMissiles).toEqual([]);
  });

  test("cooldown accepts only future timestamps", () => {
    const future = Date.now() + 10_000;

    useGameStore.getState().setAttackCooldown(future);
    expect(useGameStore.getState().attackCooldownExpiresAt).toBe(future);

    useGameStore.getState().setAttackCooldown(Date.now() - 1);
    expect(useGameStore.getState().attackCooldownExpiresAt).toBeNull();
  });

  test("formats board coordinates for visible logs", () => {
    expect(formatCoordForLog(makeCoordinate(0, 0))).toBe("А1");
    expect(formatCoordForLog(makeCoordinate(9, 9))).toBe("К10");
  });
});
