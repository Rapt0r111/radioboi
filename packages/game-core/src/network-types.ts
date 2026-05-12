// packages/game-core/src/network-types.ts
//
// Added:
//   - RoomSettings exported from types
//   - attackCooldownExpiresAt in SyncStateEvent (async mode)
//   - settings in SyncStateEvent
//   - ATTACK_COOLDOWN_UPDATE event

import type { Board, Coordinate, GamePhase, Missile, RoomSettings } from "./types";

export type { RoomSettings } from "./types";

// ── Morse primitives ──────────────────────────────────────────────────────────

export type MorseSymbol = "." | "-";
export type MorseSequence = MorseSymbol[];

// ── Event-type registry ───────────────────────────────────────────────────────

export const GameEventType = {
  JOIN_ROOM: "JOIN_ROOM",
  SHIPS_PLACED: "SHIPS_PLACED",
  ATTACK_PREP: "ATTACK_PREP",
  MISSILE_LAUNCHED: "MISSILE_LAUNCHED",
  INTERCEPT_ATTEMPT: "INTERCEPT_ATTEMPT",
  PLAYER_JOINED: "PLAYER_JOINED",
  GAME_STARTED: "GAME_STARTED",
  INCOMING_MISSILE: "INCOMING_MISSILE",
  RESOLVE_HIT: "RESOLVE_HIT",
  SYNC_STATE: "SYNC_STATE",
  ATTACK_COOLDOWN_UPDATE: "ATTACK_COOLDOWN_UPDATE",
  ERROR: "ERROR",
} as const;

export type GameEventType = (typeof GameEventType)[keyof typeof GameEventType];

// ── Client event types ────────────────────────────────────────────────────────

export type JoinRoomEvent = {
  type: typeof GameEventType.JOIN_ROOM;
  payload: { playerId: string; playerName: string };
};

export type ShipsPlacedEvent = {
  type: typeof GameEventType.SHIPS_PLACED;
  payload: { ships: ReadonlyArray<{ coords: readonly Coordinate[] }> };
};

export type AttackPrepEvent = {
  type: typeof GameEventType.ATTACK_PREP;
  payload: { target: Coordinate; missileId: string };
};

export type MissileLaunchedEvent = {
  type: typeof GameEventType.MISSILE_LAUNCHED;
  payload: {
    missileId: string;
    target: Coordinate;
    morseSequence: MorseSequence;
    timestamp: number;
  };
};

export type InterceptAttemptEvent = {
  type: typeof GameEventType.INTERCEPT_ATTEMPT;
  payload: { missileId: string; decodedCoord: Coordinate; attemptNumber: number };
};

// ── Server event types ────────────────────────────────────────────────────────

export type PlayerJoinedEvent = {
  type: typeof GameEventType.PLAYER_JOINED;
  payload: { playerId: string; playerName: string; playerCount: 1 | 2 };
};

export type GameStartedEvent = {
  type: typeof GameEventType.GAME_STARTED;
  payload: { firstTurnPlayerId: string };
};

export type IncomingMissileEvent = {
  type: typeof GameEventType.INCOMING_MISSILE;
  payload: {
    missileId: string;
    morseSequence: MorseSequence;
    timestamp: number;
    maxAttempts: number;
  };
};

export type HitResult = "hit" | "miss" | "sunk";

export type ResolveHitEvent = {
  type: typeof GameEventType.RESOLVE_HIT;
  payload: {
    missileId: string;
    target: Coordinate;
    result: HitResult;
    nextTurnPlayerId: string;
    isGameOver: boolean;
    winnerId?: string | undefined;
    defenderDecodedCorrectly: boolean;
  };
};

export type ClientShotLogEntry = {
  by: "us" | "them";
  coord: string;
  result: HitResult;
  ts: number;
};

export type SyncStateEvent = {
  type: typeof GameEventType.SYNC_STATE;
  payload: {
    phase: GamePhase;
    ownBoard: Board;
    enemyBoard: Board;
    activeMissiles: Missile[];
    isMyTurn: boolean;
    winnerId?: string | undefined;
    shotLog: ClientShotLogEntry[];
    /** Room settings — sent on every SYNC_STATE so client stays in sync */
    settings?: RoomSettings;
    /** Async mode: unix ms when this player may attack again (0 = ready now) */
    attackCooldownExpiresAt?: number;
  };
};

/** Sent to attacker after missile resolved in async mode */
export type AttackCooldownUpdateEvent = {
  type: typeof GameEventType.ATTACK_COOLDOWN_UPDATE;
  payload: {
    /** Unix ms timestamp when player may fire again */
    expiresAt: number;
  };
};

export type ErrorEvent = {
  type: typeof GameEventType.ERROR;
  payload: { code: ErrorCode; message: string };
};

// ── Error codes ───────────────────────────────────────────────────────────────

export const ErrorCode = {
  ROOM_FULL: "ROOM_FULL",
  INVALID_PLACEMENT: "INVALID_PLACEMENT",
  NOT_YOUR_TURN: "NOT_YOUR_TURN",
  ATTACK_ON_COOLDOWN: "ATTACK_ON_COOLDOWN",
  CELL_ALREADY_SHOT: "CELL_ALREADY_SHOT",
  MORSE_MISMATCH: "MORSE_MISMATCH",
  INVALID_COORDINATE: "INVALID_COORDINATE",
  MAX_ATTEMPTS_REACHED: "MAX_ATTEMPTS_REACHED",
  GAME_NOT_STARTED: "GAME_NOT_STARTED",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ── Discriminated unions ──────────────────────────────────────────────────────

export type ClientGameEvent =
  | JoinRoomEvent
  | ShipsPlacedEvent
  | AttackPrepEvent
  | MissileLaunchedEvent
  | InterceptAttemptEvent;

export type ServerGameEvent =
  | PlayerJoinedEvent
  | GameStartedEvent
  | IncomingMissileEvent
  | ResolveHitEvent
  | SyncStateEvent
  | AttackCooldownUpdateEvent
  | ErrorEvent;

export type GameEvent = ClientGameEvent | ServerGameEvent;