// apps/worker/src/protocol.ts
//
// Binary serialisation helpers for the Worker.
// FIX: makeSyncState now accepts settings + attackCooldownExpiresAt for async mode.
// NEW:  makeAttackCooldownUpdate — sent to attacker after resolve in async mode.

import { decode, encode } from "@msgpack/msgpack";
import type { RoomSettings } from "./game-logic";

type RawEvent = { type: string; payload: Record<string, unknown> };
const MAX_FRAME_BYTES = 16_384;
const CLIENT_EVENT_TYPES = new Set([
  "JOIN_ROOM",
  "SHIPS_PLACED",
  "ATTACK_PREP",
  "MISSILE_LAUNCHED",
  "INTERCEPT_ATTEMPT",
]);

// ── Encoding ─────────────────────────────────────────────────────────────────

export function encodeEvent(event: RawEvent): Uint8Array {
  return encode(event);
}

// ── Decoding ─────────────────────────────────────────────────────────────────

export function decodeEvent(msg: string | ArrayBuffer): RawEvent | null {
  try {
    if (typeof msg === "string") return null;
    if (msg.byteLength > MAX_FRAME_BYTES) return null;
    const buf = msg instanceof ArrayBuffer ? new Uint8Array(msg) : msg;
    const value = decode(buf);
    const record = value as Record<string, unknown>;
    if (
      typeof value !== "object" ||
      value === null ||
      typeof record.type !== "string" ||
      !CLIENT_EVENT_TYPES.has(record.type) ||
      typeof record.payload !== "object" ||
      record.payload === null ||
      Array.isArray(record.payload)
    ) {
      return null;
    }
    return { type: record.type, payload: record.payload as Record<string, unknown> };
  } catch {
    return null;
  }
}

// ── Typed event builders (server → client) ────────────────────────────────────

export function makePlayerJoined(
  playerId: string,
  playerName: string,
  playerCount: 1 | 2,
): Uint8Array {
  return encodeEvent({ type: "PLAYER_JOINED", payload: { playerId, playerName, playerCount } });
}

export function makeGameStarted(firstTurnPlayerId: string): Uint8Array {
  return encodeEvent({ type: "GAME_STARTED", payload: { firstTurnPlayerId } });
}

export function makeIncomingMissile(
  missileId: string,
  morseSequence: string[],
  timestamp: number,
  maxAttempts: number,
  expiresAt?: number,
  attemptsMade?: number,
): Uint8Array {
  return encodeEvent({
    type: "INCOMING_MISSILE",
    payload: {
      missileId,
      morseSequence,
      timestamp,
      maxAttempts,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(attemptsMade !== undefined ? { attemptsMade } : {}),
    },
  });
}

export function makeResolveHit(
  missileId: string,
  target: string,
  result: "hit" | "miss" | "sunk",
  nextTurnPlayerId: string,
  isGameOver: boolean,
  defenderDecodedCorrectly: boolean,
  winnerId?: string,
): Uint8Array {
  return encodeEvent({
    type: "RESOLVE_HIT",
    payload: {
      missileId,
      target,
      result,
      nextTurnPlayerId,
      isGameOver,
      defenderDecodedCorrectly,
      ...(winnerId !== undefined ? { winnerId } : {}),
    },
  });
}

type ShotLogEntry = {
  by: "us" | "them";
  coord: string;
  result: "hit" | "miss" | "sunk";
  ts: number;
};

export function makeSyncState(
  phase: string,
  ownBoard: Record<string, string>,
  enemyBoard: Record<string, string>,
  activeMissiles: unknown[],
  isMyTurn: boolean,
  shotLog: ShotLogEntry[],
  winnerId?: string,
  settings?: RoomSettings,
  attackCooldownExpiresAt?: number,
): Uint8Array {
  return encodeEvent({
    type: "SYNC_STATE",
    payload: {
      phase,
      ownBoard,
      enemyBoard,
      activeMissiles,
      isMyTurn,
      shotLog,
      ...(winnerId !== undefined ? { winnerId } : {}),
      ...(settings !== undefined ? { settings } : {}),
      ...(attackCooldownExpiresAt !== undefined ? { attackCooldownExpiresAt } : {}),
    },
  });
}

/** Sent only to the attacker immediately after their missile resolves (async mode) */
export function makeAttackCooldownUpdate(expiresAt: number): Uint8Array {
  return encodeEvent({
    type: "ATTACK_COOLDOWN_UPDATE",
    payload: { expiresAt },
  });
}

export function makeError(code: string, message: string): Uint8Array {
  return encodeEvent({ type: "ERROR", payload: { code, message } });
}
