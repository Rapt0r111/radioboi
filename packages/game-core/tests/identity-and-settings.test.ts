import { describe, expect, test } from "bun:test";
import {
  clampRoomSettings,
  GameEventType,
  generateSeatToken,
  isValidMissileId,
  isValidPlayerId,
  isValidSeatToken,
  MIN_GUIDED_ATTACK_COOLDOWN_MS,
  normalizeRoomId,
  parseServerGameEvent,
} from "../src/index";

describe("room and player identity", () => {
  test("normalizes 6-character room codes and rejects junk", () => {
    expect(normalizeRoomId("ab12cd")).toBe("AB12CD");
    expect(normalizeRoomId("  zz9k2a ")).toBe("ZZ9K2A");
    expect(normalizeRoomId("nope")).toBeNull();
    expect(normalizeRoomId("ROOM-1")).toBeNull();
    expect(normalizeRoomId("TOOLONG1")).toBeNull();
  });

  test("accepts compact player and missile ids used in tests and UUIDs", () => {
    expect(isValidPlayerId("p1")).toBe(true);
    expect(isValidPlayerId("player-uuid-1")).toBe(true);
    expect(isValidMissileId("m-intercept")).toBe(true);
    expect(isValidMissileId("m-blocked-АБВ000")).toBe(true);
    expect(isValidPlayerId("")).toBe(false);
    expect(isValidPlayerId("x".repeat(65))).toBe(false);
    expect(isValidPlayerId("p1/../admin")).toBe(false);
    const token = generateSeatToken();
    expect(isValidSeatToken(token)).toBe(true);
    expect(isValidSeatToken("short")).toBe(false);
  });
});

describe("clampRoomSettings", () => {
  test("uses difficulty-aware cooldown floors", () => {
    expect(
      clampRoomSettings({
        battleMode: "async",
        difficulty: "beginner",
        attackCooldownMs: 1,
        interceptWindowMs: 999_999,
        maxInterceptAttempts: 99,
      }),
    ).toEqual({
      battleMode: "async",
      difficulty: "beginner",
      attackCooldownMs: MIN_GUIDED_ATTACK_COOLDOWN_MS,
      interceptWindowMs: 60_000,
      maxInterceptAttempts: 5,
    });

    expect(clampRoomSettings({ difficulty: "expert", attackCooldownMs: 500 }).attackCooldownMs).toBe(
      2_000,
    );
  });
});

describe("parseServerGameEvent", () => {
  test("accepts well-formed server frames and rejects client or junk types", () => {
    expect(
      parseServerGameEvent({
        type: GameEventType.GAME_STARTED,
        payload: { firstTurnPlayerId: "p1" },
      }),
    ).toEqual({
      type: GameEventType.GAME_STARTED,
      payload: { firstTurnPlayerId: "p1" },
    });

    expect(
      parseServerGameEvent({
        type: GameEventType.JOIN_ROOM,
        payload: { playerId: "p1", playerName: "x" },
      }),
    ).toBeNull();

    expect(parseServerGameEvent({ type: "SYNC_STATE", payload: { phase: "battle" } })).toBeNull();
  });
});
