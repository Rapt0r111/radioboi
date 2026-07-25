import { describe, expect, test } from "bun:test";
import { BOARD_COLUMN_LABELS, BOARD_ROW_LABELS, makeCoordinate } from "@radioboi/game-core";
import {
  addAttackerTurnAlarm,
  addInterceptAlarm,
  addPlayer,
  applyShipsPlaced,
  clampRoomSettings,
  createRoomState,
  formatCoordForShotLog,
  getCooldownRemaining,
  getEnemyBoard,
  getOpponentId,
  nextAlarmAt,
  popExpiredAlarms,
  prepareAttack,
  processInterceptAttempt,
  recordMorseSequence,
  replacePlayerId,
  resolveHit,
  validateShipGeometry,
} from "../src/game-logic";
import {
  charToMorse,
  coordIndicesToMorse,
  morseToChar,
  morseToCoordIndices,
  splitMorseSequence,
  validateMorseForCoord,
} from "../src/morse";
import { closeWebSocketSafely } from "../src/websocket";

function validFleet() {
  return [
    { coords: [0, 1, 2, 3].map((col) => makeCoordinate(col, 0)) },
    { coords: [0, 1, 2].map((col) => makeCoordinate(col, 2)) },
    { coords: [0, 1, 2].map((col) => makeCoordinate(col, 4)) },
    { coords: [0, 1].map((col) => makeCoordinate(col, 6)) },
    { coords: [3, 4].map((col) => makeCoordinate(col, 6)) },
    { coords: [6, 7].map((col) => makeCoordinate(col, 6)) },
    { coords: [makeCoordinate(0, 8)] },
    { coords: [makeCoordinate(2, 8)] },
    { coords: [makeCoordinate(4, 8)] },
    { coords: [makeCoordinate(6, 8)] },
  ];
}

function roomReadyForBattle() {
  const state = createRoomState("ROOM42");
  addPlayer(state, { id: "p1", name: "P1", wsTag: "a", isReady: false });
  addPlayer(state, { id: "p2", name: "P2", wsTag: "b", isReady: false });
  applyShipsPlaced(state, "p1", validFleet());
  applyShipsPlaced(state, "p2", validFleet());
  state.currentTurnId = "p1";
  return state;
}

describe("room lifecycle", () => {
  test("clamps room settings from untrusted input", () => {
    expect(
      clampRoomSettings({
        battleMode: "async",
        attackCooldownMs: 1,
        interceptWindowMs: 999_999,
        maxInterceptAttempts: 99,
      }),
    ).toEqual({
      battleMode: "async",
      attackCooldownMs: 2_000,
      interceptWindowMs: 60_000,
      maxInterceptAttempts: 5,
    });

    expect(clampRoomSettings(null).battleMode).toBe("turn-based");
  });

  test("moves from lobby to placement when the second player joins", () => {
    const state = createRoomState("ROOM42");

    expect(addPlayer(state, { id: "p1", name: "P1", wsTag: "a", isReady: false })).toEqual({
      ok: true,
    });
    expect(state.phase).toBe("lobby");
    expect(addPlayer(state, { id: "p2", name: "P2", wsTag: "b", isReady: false })).toEqual({
      ok: true,
    });
    expect(state.phase).toBe("placement");
    expect(getOpponentId(state, "p1")).toBe("p2");
  });

  test("rejects invalid fleets before mutating battle state", () => {
    expect(validateShipGeometry([{ coords: [makeCoordinate(0, 0), makeCoordinate(1, 1)] }])).toContain(
      "not linear",
    );
  });

  test("can claim a disconnected full-room slot without losing state", () => {
    const state = roomReadyForBattle();
    const oldTarget = makeCoordinate(0, 8);
    state.attackCooldowns.p1 = 12345;
    state.pendingAttacks.p1 = {
      attackerId: "p1",
      attempts: 1,
      missileId: "m-reconnect",
      morseSequence: ["."],
      target: oldTarget,
    };
    state.pendingAlarms.push({
      type: "intercept_timeout",
      attackerId: "p1",
      missileId: "m-reconnect",
      fireAt: Date.now() + 1000,
    });

    expect(
      replacePlayerId(state, "p1", {
        id: "p1-new",
        name: "P1 reconnected",
        wsTag: "new",
        isReady: false,
      }),
    ).toBe(true);

    expect(state.players.some((p) => p.id === "p1-new" && p.isReady)).toBe(true);
    expect(state.boards["p1-new"]).toBeDefined();
    expect(state.boards.p1).toBeUndefined();
    expect(state.currentTurnId).toBe("p1-new");
    expect(state.attackCooldowns["p1-new"]).toBe(12345);
    expect(state.pendingAttacks["p1-new"]?.attackerId).toBe("p1-new");
    expect(state.pendingAlarms[0]?.attackerId).toBe("p1-new");
  });
});

describe("attack resolution", () => {
  test("records a miss, masks enemy ships, and passes the turn", () => {
    const state = roomReadyForBattle();
    const target = makeCoordinate(9, 9);

    expect(prepareAttack(state, "p1", target, "m1")).toEqual({ ok: true });
    expect(recordMorseSequence(state, "m1", [".", "-"])).toEqual({ ok: true });

    expect(processInterceptAttempt(state, "p2", "m1", makeCoordinate(8, 8))).toBeNull();
    expect(processInterceptAttempt(state, "p2", "m1", makeCoordinate(8, 8))).toBeNull();
    const result = processInterceptAttempt(state, "p2", "m1", makeCoordinate(8, 8));

    expect(result).toEqual({ result: "miss", isGameOver: false, winnerId: null });
    expect(state.currentTurnId).toBe("p2");
    expect(state.pendingAttacks).toEqual({});
    expect(getEnemyBoard(state, "p1")[target]).toBe("miss");
  });

  test("intercepts a correctly decoded missile without damaging the board", () => {
    const state = roomReadyForBattle();
    const target = makeCoordinate(0, 8);

    expect(prepareAttack(state, "p1", target, "m-intercept")).toEqual({ ok: true });
    expect(recordMorseSequence(state, "m-intercept", [".", "-"])).toEqual({ ok: true });

    const result = processInterceptAttempt(state, "p2", "m-intercept", target);

    expect(result).toEqual({ intercepted: true, attackerId: "p1", target });
    expect(state.pendingAttacks).toEqual({});
    expect(state.boards.p2?.[target]).toBe("ship");
    expect(state.shotLog).toHaveLength(0);
    expect(state.currentTurnId).toBe("p2");
  });


  test("does not allow missile intercept attempts in async mode", () => {
    const state = roomReadyForBattle();
    state.settings.battleMode = "async";
    const target = makeCoordinate(0, 8);

    expect(prepareAttack(state, "p1", target, "m-no-intercept")).toEqual({ ok: true });
    expect(recordMorseSequence(state, "m-no-intercept", [".", "-"]).ok).toBe(true);

    expect(processInterceptAttempt(state, "p2", "m-no-intercept", target)).toBeNull();
    expect(state.pendingAttacks.p1?.attempts).toBe(0);
    expect(state.boards.p2?.[target]).toBe("ship");
  });

  test("starts async cooldown when the missile launches", () => {
    const state = roomReadyForBattle();
    state.settings.battleMode = "async";
    state.settings.attackCooldownMs = 2_000;
    state.currentTurnId = null;
    const target = makeCoordinate(9, 9);

    expect(prepareAttack(state, "p1", target, "m-async")).toEqual({ ok: true });
    const launched = recordMorseSequence(state, "m-async", [".", "-"]);

    expect(launched.ok).toBe(true);
    if (launched.ok) {
      expect(launched.cooldownExpiresAt).toBeGreaterThan(Date.now());
    }
    expect(getCooldownRemaining(state, "p1")).toBeGreaterThan(0);
    expect(prepareAttack(state, "p1", makeCoordinate(8, 8), "m-blocked")).toEqual({
      ok: false,
      reason: "ATTACK_ON_COOLDOWN",
    });
  });

  test("allows the opponent to fire independently during async cooldown", () => {
    const state = roomReadyForBattle();
    state.settings.battleMode = "async";
    state.settings.attackCooldownMs = 2_000;
    state.currentTurnId = null;

    const p1Target = makeCoordinate(9, 9);
    const p2Target = makeCoordinate(8, 8);

    expect(prepareAttack(state, "p1", p1Target, "m-p1")).toEqual({ ok: true });
    expect(recordMorseSequence(state, "m-p1", [".", "-"]).ok).toBe(true);
    expect(resolveHit(state, "p1", p1Target, "m-p1").result).toBe("miss");

    expect(prepareAttack(state, "p2", p2Target, "m-p2")).toEqual({ ok: true });
    expect(state.currentTurnId).toBeNull();
    expect(state.pendingAlarms).toEqual([]);
  });

  test("rejects malformed targets before creating a pending attack", () => {
    const state = roomReadyForBattle();

    expect(prepareAttack(state, "p1", "BAD", "m-invalid")).toEqual({
      ok: false,
      reason: "INVALID_COORDINATE",
    });
    expect(state.pendingAttacks).toEqual({});
  });

  test("enforces turn ownership and one pending attack in turn-based mode", () => {
    const state = roomReadyForBattle();
    const firstTarget = makeCoordinate(9, 9);

    expect(prepareAttack(state, "p2", firstTarget, "m-wrong-turn")).toEqual({
      ok: false,
      reason: "NOT_YOUR_TURN",
    });
    expect(prepareAttack(state, "p1", firstTarget, "m-first")).toEqual({ ok: true });
    expect(prepareAttack(state, "p1", makeCoordinate(8, 8), "m-second")).toEqual({
      ok: false,
      reason: "ATTACK_ALREADY_PENDING",
    });
  });

  test("keeps intercept attempts server-owned and blocks self-intercepts", () => {
    const state = roomReadyForBattle();
    const target = makeCoordinate(9, 9);
    const wrongTarget = makeCoordinate(8, 8);

    expect(prepareAttack(state, "p1", target, "m-secure")).toEqual({ ok: true });
    expect(recordMorseSequence(state, "m-secure", [".", "-"])).toEqual({ ok: true });

    expect(processInterceptAttempt(state, "p1", "m-secure", target)).toBeNull();
    expect(state.pendingAttacks.p1?.attempts).toBe(0);

    expect(processInterceptAttempt(state, "p2", "m-secure", wrongTarget)).toBeNull();
    expect(state.pendingAttacks.p1?.attempts).toBe(1);

    expect(processInterceptAttempt(state, "p2", "m-secure", wrongTarget)).toBeNull();
    expect(state.pendingAttacks.p1?.attempts).toBe(2);

    const result = processInterceptAttempt(state, "p2", "m-secure", wrongTarget);
    expect(result).toEqual({ result: "miss", isGameOver: false, winnerId: null });
    expect(state.pendingAttacks).toEqual({});
  });

  test("keeps the turn after a hit and sinks a single-cell ship", () => {
    const state = roomReadyForBattle();
    const target = makeCoordinate(0, 8);

    const result = resolveHit(state, "p1", target, "m2");

    expect(result.result).toBe("sunk");
    expect(state.currentTurnId).toBe("p1");
    expect(state.boards.p2?.[target]).toBe("sunk");
    expect(state.shotLog.at(-1)?.target).toBe(target);
  });

  test("sets game over winner when the final ship is sunk", () => {
    const state = roomReadyForBattle();
    const target = makeCoordinate(0, 0);
    state.boards.p2 = { [target]: "ship" };
    state.ships.p2 = [{ coords: [target], isSunk: false }];

    const result = resolveHit(state, "p1", target, "m-final");

    expect(result).toEqual({ result: "sunk", isGameOver: true, winnerId: "p1" });
    expect(state.phase).toBe("gameOver");
    expect(state.winnerId).toBe("p1");
  });

  test("marks and blocks all legal exclusion cells around a sunk ship", () => {
    const state = roomReadyForBattle();
    const target = makeCoordinate(0, 8);
    const blockedAroundTarget = [
      makeCoordinate(0, 7),
      makeCoordinate(1, 7),
      makeCoordinate(1, 8),
      makeCoordinate(0, 9),
      makeCoordinate(1, 9),
    ];

    expect(resolveHit(state, "p1", target, "m-sunk-ring").result).toBe("sunk");

    for (const coord of blockedAroundTarget) {
      expect(state.boards.p2?.[coord]).toBe("blocked");
      expect(getEnemyBoard(state, "p1")[coord]).toBe("blocked");
      expect(prepareAttack(state, "p1", coord, `m-blocked-${coord}`)).toEqual({
        ok: false,
        reason: "CELL_ALREADY_SHOT",
      });
    }
  });

  test("formats shot log coordinates as visible board labels", () => {
    const coord = makeCoordinate(0, 0);

    expect(formatCoordForShotLog(coord)).toBe(
      `${BOARD_ROW_LABELS[0]}${BOARD_COLUMN_LABELS[0]}`,
    );
    expect(formatCoordForShotLog(coord)).not.toContain("-");
  });
});

describe("alarm scheduling", () => {
  test("records a stable intercept deadline for reconnect payloads", () => {
    const state = roomReadyForBattle();
    const fireAt = addInterceptAlarm(state, "m-deadline", "p1", 15_000);

    expect(state.pendingAlarms[0]).toMatchObject({
      type: "intercept_timeout",
      missileId: "m-deadline",
      attackerId: "p1",
      fireAt,
    });
    expect(fireAt).toBeGreaterThan(Date.now());
  });

  test("sorts alarms, replaces attacker-turn timeout, and pops expired entries", () => {
    const state = roomReadyForBattle();
    const now = Date.now();

    addInterceptAlarm(state, "m-late", "p1", 30_000);
    addAttackerTurnAlarm(state, 20_000);
    addAttackerTurnAlarm(state, 10_000);
    state.pendingAlarms.push({ type: "intercept_timeout", missileId: "old", attackerId: "p1", fireAt: now - 1 });
    state.pendingAlarms.sort((a, b) => a.fireAt - b.fireAt);

    expect(state.pendingAlarms.filter((alarm) => alarm.type === "attacker_turn_timeout")).toHaveLength(1);
    expect(nextAlarmAt(state)).toBeLessThanOrEqual(now);
    expect(popExpiredAlarms(state)).toEqual([
      { type: "intercept_timeout", missileId: "old", attackerId: "p1", fireAt: now - 1 },
    ]);
    expect(nextAlarmAt(state)).toBeGreaterThan(now);
  });
});

describe("worker Morse validation", () => {
  test("splits and validates coordinate Morse sequences", () => {
    const sequence = [".", "-", ".", "-", "-", "-", "-"] as const;

    expect(coordIndicesToMorse(0, 0)).toEqual([".-", ".----"]);
    expect(splitMorseSequence(sequence)).toEqual([".-", ".----"]);
    expect(validateMorseForCoord(sequence, 0, 0)).toBe(true);
    expect(validateMorseForCoord(sequence, 1, 0)).toBe(false);
  });

  test("rejects invalid Morse tokens and out-of-range coordinate indices", () => {
    expect(charToMorse("А")).toBe(".-");
    expect(charToMorse("@")).toBeNull();
    expect(morseToChar("......")).toBeNull();
    expect(morseToCoordIndices("......", ".----")).toBeNull();
    expect(splitMorseSequence([".", "."])).toBeNull();
    expect(() => coordIndicesToMorse(10, 0)).toThrow(RangeError);
  });
});

describe("websocket lifecycle", () => {
  test("ignores close errors from already-closed sockets", () => {
    const socket = {
      close() {
        throw new Error("already closed");
      },
    };

    expect(() => closeWebSocketSafely(socket, 1000, "closed")).not.toThrow();
  });
});
