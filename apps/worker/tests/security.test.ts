import { describe, expect, test } from "bun:test";
import { addPlayer, createRoomState } from "../src/game-logic";
import {
  authenticateExistingSeat,
  claimSeat,
  generateSeatToken,
  makePlayerRecord,
} from "../src/player-presence";
import { envFlagEnabled, isOriginAllowed, MessageRateLimiter } from "../src/security";

describe("seat authentication", () => {
  test("rejects a reconnect that knows the public playerId but not the seat token", () => {
    const player = makePlayerRecord({
      id: "p1",
      name: "Victim",
      wsTag: "player:p1",
      seatToken: generateSeatToken(),
    });

    expect(authenticateExistingSeat(player, null).ok).toBe(false);
    expect(authenticateExistingSeat(player, "not-the-token").ok).toBe(false);
    expect(authenticateExistingSeat(player, player.seatToken)).toEqual({ ok: true });
  });

  test("mints a token for legacy seats with an empty secret", () => {
    const player = makePlayerRecord({ id: "p1", name: "Legacy", wsTag: "player:p1" });
    expect(player.seatToken).toBe("");
    expect(authenticateExistingSeat(player, null)).toEqual({ ok: true });
    expect(player.seatToken.length).toBeGreaterThan(8);
    expect(authenticateExistingSeat(player, null).ok).toBe(false);
    expect(authenticateExistingSeat(player, player.seatToken)).toEqual({ ok: true });
  });

  test("refresh that rotated playerId reclaims the seat by token instead of ROOM_FULL", () => {
    const state = createRoomState("ROOM1");
    const token = generateSeatToken();
    addPlayer(state, makePlayerRecord({ id: "p1", name: "A", wsTag: "player:p1", seatToken: token }));
    addPlayer(state, makePlayerRecord({
      id: "p2",
      name: "B",
      wsTag: "player:p2",
      seatToken: generateSeatToken(),
    }));

    expect(claimSeat(state, "p1-after-refresh", token)).toMatchObject({ kind: "reconnect" });
    expect(state.players.map((player) => player.id).sort()).toEqual(["p1-after-refresh", "p2"]);
    expect(claimSeat(state, "p1-after-refresh", null)).toMatchObject({
      kind: "reject",
      reason: "AUTH_FAILED",
    });
    expect(claimSeat(state, "intruder", null)).toMatchObject({
      kind: "reject",
      reason: "ROOM_FULL",
    });
  });
});

describe("worker request guards", () => {
  test("empty origin allowlist permits any caller", () => {
    expect(isOriginAllowed(null, "")).toBe(true);
    expect(isOriginAllowed("http://192.168.0.10:3000", "  ")).toBe(true);
  });

  test("non-empty allowlist requires an exact Origin match", () => {
    const list = "https://game.example,https://other.example";
    expect(isOriginAllowed("https://game.example", list)).toBe(true);
    expect(isOriginAllowed("https://evil.example", list)).toBe(false);
    expect(isOriginAllowed(null, list)).toBe(false);
  });

  test("rate-limits a noisy player without blocking a second player", () => {
    const limiter = new MessageRateLimiter(3, 1_000);
    expect(limiter.allow("p1", 1)).toBe(true);
    expect(limiter.allow("p1", 2)).toBe(true);
    expect(limiter.allow("p1", 3)).toBe(true);
    expect(limiter.allow("p1", 4)).toBe(false);
    expect(limiter.allow("p2", 4)).toBe(true);
    expect(limiter.allow("p1", 1_002)).toBe(true);
  });

  test("parses registry env flags", () => {
    expect(envFlagEnabled(undefined)).toBe(false);
    expect(envFlagEnabled("false")).toBe(false);
    expect(envFlagEnabled("true")).toBe(true);
    expect(envFlagEnabled("1")).toBe(true);
  });
});
