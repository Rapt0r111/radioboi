// apps/worker/src/protocol.ts
// Binary serialisation helpers for the Worker.
// All network frames use @msgpack/msgpack to minimise bytes and avoid
// JSON string-parsing overhead on the hot path.

import { decode, encode } from "@msgpack/msgpack";

// ── Generic event shape (worker-internal, no @radioboi/game-core import) ──────

// We don't import typed GameEvent here because the Worker doesn't
// depend on @radioboi/game-core.  Instead we work with plain objects
// and let the discriminated `type` field drive logic.

type RawEvent = { type: string; payload: Record<string, unknown> };

// ── Encoding ─────────────────────────────────────────────────────────────────

/**
 * Serialises any event object to a MessagePack Uint8Array.
 * The result is sent directly over WebSocket as a binary frame.
 */
export function encodeEvent(event: RawEvent): Uint8Array {
  return encode(event);
}

// ── Decoding ─────────────────────────────────────────────────────────────────

/**
 * Deserialises an incoming binary frame.
 * Returns null if the frame is not a valid MessagePack object with
 * a string `type` and an object `payload`.
 *
 * NEVER throws — malformed frames are silently discarded to prevent
 * a single bad client from crashing the Durable Object.
 */
export function decodeEvent(msg: string | ArrayBuffer): RawEvent | null {
  try {
    // Cloudflare WebSocket Hibernation API can deliver string frames too.
    // We only handle binary; text frames are rejected.
    if (typeof msg === "string") return null;

    const buf = msg instanceof ArrayBuffer ? new Uint8Array(msg) : msg;
    const value = decode(buf);

    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as Record<string, unknown>)["type"] !== "string" ||
      typeof (value as Record<string, unknown>)["payload"] !== "object"
    ) {
      return null;
    }

    return value as RawEvent;
  } catch {
    return null;
  }
}

// ── Typed event builders (server → client) ────────────────────────────────────
// These mirror the payload types in @radioboi/game-core/network-types
// but are defined as plain factory functions so the Worker stays
// dependency-free.  Keep in sync with network-types.ts.

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

export function makeSyncState(
  phase: string,
  ownBoard: Record<string, string>,
  enemyBoard: Record<string, string>,
  activeMissiles: unknown[],
  isMyTurn: boolean,
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
      ...(winnerId !== undefined ? { winnerId } : {}),
    },
  });
}

export function makeError(code: string, message: string): Uint8Array {
  return encodeEvent({ type: "ERROR", payload: { code, message } });
}
