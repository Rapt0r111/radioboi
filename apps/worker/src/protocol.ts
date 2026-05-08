// apps/worker/src/protocol.ts
// Binary serialisation helpers for the Worker.
// All network frames use @msgpack/msgpack to minimise bytes and avoid
// JSON string-parsing overhead on the hot path.
//
// FIX (HIGH): makeSyncState теперь принимает shotLog — историю выстрелов,
// уже отформатированную с точки зрения конкретного игрока (by: "us"|"them").
// Это позволяет восстанавливать историю при реконнекте через SYNC_STATE.

import { decode, encode } from "@msgpack/msgpack";

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
  return encodeEvent({
    type: "PLAYER_JOINED",
    payload: { playerId, playerName, playerCount },
  });
}

export function makeGameStarted(firstTurnPlayerId: string): Uint8Array {
  return encodeEvent({
    type: "GAME_STARTED",
    payload: { firstTurnPlayerId },
  });
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

/** Элемент истории выстрелов в SYNC_STATE (перспектива конкретного игрока). */
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
  /** История выстрелов с точки зрения получателя. Обязателен (передай [] если нет ходов). */
  shotLog: ShotLogEntry[],
  winnerId?: string,
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
    },
  });
}

export function makeError(code: string, message: string): Uint8Array {
  return encodeEvent({ type: "ERROR", payload: { code, message } });
}