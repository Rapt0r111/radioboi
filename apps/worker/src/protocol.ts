// apps/worker/src/protocol.ts
//
// Binary serialisation helpers for the Worker.
// FIX: makeSyncState now accepts settings + attackCooldownExpiresAt for async mode.
// NEW:  makeAttackCooldownUpdate — sent to attacker after resolve in async mode.

import { decode, encode } from "@msgpack/msgpack";
import type { RoomSettings } from "./game-logic";

type RawEvent = { type: string; payload: Record<string, unknown> };

// ── Encoding ─────────────────────────────────────────────────────────────────

export function encodeEvent(event: RawEvent): Uint8Array {
  return encode(event);
}

// ── Decoding ─────────────────────────────────────────────────────────────────

export function decodeEvent(msg: string | ArrayBuffer): RawEvent | null {
  try {
    if (typeof msg === "string") return null;
    const buf = msg instanceof ArrayBuffer ? new Uint8Array(msg) : msg;
    const value = decode(buf);
    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as Record<string, unknown>).type !== "string" ||
      typeof (value as Record<string, unknown>).payload !== "object"
    ) {
      return null;
    }
    return value as RawEvent;
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
): Uint8Array {
  return encodeEvent({
    type: "INCOMING_MISSILE",
    payload: { missileId, morseSequence, timestamp, maxAttempts },
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