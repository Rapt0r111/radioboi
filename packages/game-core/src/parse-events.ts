import { GameEventType, type ErrorCode, type HitResult, type ServerGameEvent } from "./network-types";
import type { Coordinate } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asCoord(value: unknown): Coordinate | null {
  return typeof value === "string" ? (value as Coordinate) : null;
}

const HIT_RESULTS = new Set<HitResult>(["hit", "miss", "sunk"]);

/**
 * Structural parse of a decoded MessagePack value.
 * Unknown types and malformed payloads are rejected so a LAN MITM cannot
 * smash the client store with arbitrary objects.
 */
export function parseServerGameEvent(value: unknown): ServerGameEvent | null {
  if (!isRecord(value)) return null;
  const type = asString(value.type);
  if (type === null || !isRecord(value.payload)) return null;
  const payload = value.payload;

  switch (type) {
    case GameEventType.PLAYER_JOINED: {
      const playerId = asString(payload.playerId);
      const playerName = asString(payload.playerName);
      const playerCount = payload.playerCount;
      if (playerId === null || playerName === null || (playerCount !== 1 && playerCount !== 2)) {
        return null;
      }
      return { type, payload: { playerId, playerName, playerCount } };
    }
    case GameEventType.GAME_STARTED: {
      const firstTurnPlayerId = asString(payload.firstTurnPlayerId);
      if (firstTurnPlayerId === null) return null;
      return { type, payload: { firstTurnPlayerId } };
    }
    case GameEventType.MISSILE_FIRED: {
      const missileId = asString(payload.missileId);
      const attackerId = asString(payload.attackerId);
      const timestamp = asNumber(payload.timestamp);
      if (missileId === null || attackerId === null || timestamp === null) return null;
      return { type, payload: { missileId, attackerId, timestamp } };
    }
    case GameEventType.INCOMING_MISSILE: {
      const missileId = asString(payload.missileId);
      const timestamp = asNumber(payload.timestamp);
      const maxAttempts = asNumber(payload.maxAttempts);
      if (missileId === null || timestamp === null || maxAttempts === null) return null;
      if (!Array.isArray(payload.morseSequence)) return null;
      const morseSequence = payload.morseSequence.filter(
        (symbol): symbol is "." | "-" => symbol === "." || symbol === "-",
      );
      if (morseSequence.length !== payload.morseSequence.length) return null;
      const incomingPayload: {
        missileId: string;
        morseSequence: Array<"." | "-">;
        timestamp: number;
        maxAttempts: number;
        expiresAt?: number;
        attemptsMade?: number;
      } = { missileId, morseSequence, timestamp, maxAttempts };
      if (payload.expiresAt !== undefined) {
        const expiresAt = asNumber(payload.expiresAt);
        if (expiresAt === null) return null;
        incomingPayload.expiresAt = expiresAt;
      }
      if (payload.attemptsMade !== undefined) {
        const attemptsMade = asNumber(payload.attemptsMade);
        if (attemptsMade === null) return null;
        incomingPayload.attemptsMade = attemptsMade;
      }
      return { type, payload: incomingPayload };
    }
    case GameEventType.RESOLVE_HIT: {
      const missileId = asString(payload.missileId);
      const attackerId = asString(payload.attackerId);
      const target = asCoord(payload.target);
      const result = asString(payload.result);
      const nextTurnPlayerId = asString(payload.nextTurnPlayerId);
      const isGameOver = asBoolean(payload.isGameOver);
      const defenderDecodedCorrectly = asBoolean(payload.defenderDecodedCorrectly);
      if (
        missileId === null ||
        attackerId === null ||
        target === null ||
        result === null ||
        !HIT_RESULTS.has(result as HitResult) ||
        nextTurnPlayerId === null ||
        isGameOver === null ||
        defenderDecodedCorrectly === null
      ) {
        return null;
      }
      const resolvePayload: {
        missileId: string;
        attackerId: string;
        target: Coordinate;
        result: HitResult;
        nextTurnPlayerId: string;
        isGameOver: boolean;
        defenderDecodedCorrectly: boolean;
        winnerId?: string;
      } = {
        missileId,
        attackerId,
        target,
        result: result as HitResult,
        nextTurnPlayerId,
        isGameOver,
        defenderDecodedCorrectly,
      };
      if (payload.winnerId !== undefined) {
        const winnerId = asString(payload.winnerId);
        if (winnerId === null) return null;
        resolvePayload.winnerId = winnerId;
      }
      return { type, payload: resolvePayload };
    }
    case GameEventType.MISSILE_INTERCEPTED: {
      const missileId = asString(payload.missileId);
      const target = asCoord(payload.target);
      const nextTurnPlayerId = asString(payload.nextTurnPlayerId);
      if (missileId === null || target === null || nextTurnPlayerId === null) return null;
      return { type, payload: { missileId, target, nextTurnPlayerId } };
    }
    case GameEventType.SYNC_STATE: {
      const phase = asString(payload.phase);
      const isMyTurn = asBoolean(payload.isMyTurn);
      if (
        phase === null ||
        isMyTurn === null ||
        !isRecord(payload.ownBoard) ||
        !isRecord(payload.enemyBoard) ||
        !Array.isArray(payload.activeMissiles) ||
        !Array.isArray(payload.shotLog)
      ) {
        return null;
      }
      const winnerId = payload.winnerId === undefined ? undefined : asString(payload.winnerId);
      const seatToken = payload.seatToken === undefined ? undefined : asString(payload.seatToken);
      const attackCooldownExpiresAt =
        payload.attackCooldownExpiresAt === undefined
          ? undefined
          : asNumber(payload.attackCooldownExpiresAt);
      if (payload.winnerId !== undefined && winnerId === null) return null;
      if (payload.seatToken !== undefined && seatToken === null) return null;
      if (payload.attackCooldownExpiresAt !== undefined && attackCooldownExpiresAt === null) {
        return null;
      }
      return value as ServerGameEvent;
    }
    case GameEventType.ATTACK_COOLDOWN_UPDATE: {
      const expiresAt = asNumber(payload.expiresAt);
      if (expiresAt === null) return null;
      return { type, payload: { expiresAt } };
    }
    case GameEventType.ERROR: {
      const code = asString(payload.code);
      const message = asString(payload.message);
      if (code === null || message === null) return null;
      return { type, payload: { code: code as ErrorCode, message } };
    }
    default:
      return null;
  }
}
