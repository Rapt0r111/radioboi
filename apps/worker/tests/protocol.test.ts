import { decode, encode } from "@msgpack/msgpack";
import { describe, expect, test } from "bun:test";
import {
  decodeEvent,
  makeAttackCooldownUpdate,
  makeIncomingMissile,
  makeMissileFired,
  makeSyncState,
} from "../src/protocol";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("worker protocol decoding", () => {
  test("accepts known binary client events with object payloads", () => {
    const payload = { playerId: "p1", playerName: "Player" };
    const frame = toArrayBuffer(encode({ type: "JOIN_ROOM", payload }));

    expect(decodeEvent(frame)).toEqual({ type: "JOIN_ROOM", payload });
  });

  test("rejects text, oversized frames, unknown types, and non-object payloads", () => {
    expect(decodeEvent("JOIN_ROOM")).toBeNull();
    expect(decodeEvent(new ArrayBuffer(16_385))).toBeNull();
    expect(decodeEvent(toArrayBuffer(encode({ type: "NOPE", payload: {} })))).toBeNull();
    expect(decodeEvent(toArrayBuffer(encode({ type: "JOIN_ROOM", payload: null })))).toBeNull();
    expect(decodeEvent(toArrayBuffer(encode({ type: "JOIN_ROOM", payload: [] })))).toBeNull();
  });
});

describe("worker protocol event builders", () => {
  test("includes async settings and cooldown in sync snapshots", () => {
    const event = decode(
      makeSyncState(
        "battle",
        { a: "ship" },
        { b: "miss" },
        [{ id: "m1" }],
        false,
        [{ by: "us", coord: "A1", result: "hit", ts: 1 }],
        "p1",
        {
          battleMode: "async",
          difficulty: "normal",
          attackCooldownMs: 2_000,
          interceptWindowMs: 25_000,
          maxInterceptAttempts: 3,
        },
        123,
      ),
    );

    expect(event).toEqual({
      type: "SYNC_STATE",
      payload: {
        phase: "battle",
        ownBoard: { a: "ship" },
        enemyBoard: { b: "miss" },
        activeMissiles: [{ id: "m1" }],
        isMyTurn: false,
        shotLog: [{ by: "us", coord: "A1", result: "hit", ts: 1 }],
        winnerId: "p1",
        settings: {
          battleMode: "async",
          difficulty: "normal",
          attackCooldownMs: 2_000,
          interceptWindowMs: 25_000,
          maxInterceptAttempts: 3,
        },
        attackCooldownExpiresAt: 123,
      },
    });
  });

  test("omits optional incoming missile fields when not provided", () => {
    expect(decode(makeIncomingMissile("m1", ["."], 1, 3))).toEqual({
      type: "INCOMING_MISSILE",
      payload: {
        missileId: "m1",
        morseSequence: ["."],
        timestamp: 1,
        maxAttempts: 3,
      },
    });
  });

  test("builds a target-private missile fired event", () => {
    expect(decode(makeMissileFired("m1", "p1", 123))).toEqual({
      type: "MISSILE_FIRED",
      payload: { missileId: "m1", attackerId: "p1", timestamp: 123 },
    });
  });

  test("includes the room roster in sync snapshots when provided", () => {
    expect(
      decode(
        makeSyncState(
          "lobby",
          {},
          {},
          [],
          false,
          [],
          undefined,
          undefined,
          undefined,
          [{ id: "p1", name: "Моряк" }],
        ),
      ),
    ).toMatchObject({
      type: "SYNC_STATE",
      payload: { players: [{ id: "p1", name: "Моряк" }] },
    });
  });

  test("builds attack cooldown update events", () => {
    expect(decode(makeAttackCooldownUpdate(456))).toEqual({
      type: "ATTACK_COOLDOWN_UPDATE",
      payload: { expiresAt: 456 },
    });
  });
});
