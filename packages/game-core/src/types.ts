// packages/game-core/src/types.ts

export type Coordinate = string & { readonly __brand: "Coordinate" };

export type GamePhase = "lobby" | "placement" | "battle" | "gameOver";

/**
 * Room roster entry on the wire (SYNC_STATE) and in the client store.
 * Presence fields are always populated by the server so clients never tri-state.
 */
export type PlayerSummary = {
  id: string;
  name: string;
  /** false while the player has no live WebSocket */
  connected: boolean;
  /** Remaining offline reconnect budget in ms (frozen while online) */
  reconnectBudgetMs: number;
  /** Absolute unix ms when offline budget hits zero; null while online */
  reconnectDeadlineAt: number | null;
};

/** Total offline reconnect budget per player per room (does not reset on rejoin). */
export const RECONNECT_BUDGET_MS = 10 * 60 * 1000;

/** Turn-based attacker turn timeout (server + client UI). */
export const ATTACKER_TURN_TIMEOUT_MS = 90_000;

/** Local optimistic roster entry before the first SYNC_STATE. */
export function makeLocalPlayerSummary(id: string, name: string): PlayerSummary {
  return {
    id,
    name,
    connected: true,
    reconnectBudgetMs: RECONNECT_BUDGET_MS,
    reconnectDeadlineAt: null,
  };
}

export const PLAYER_NAME_MAX_LENGTH = 24;

/** Normalizes a user-provided player name for use in the game protocol. */
export function normalizePlayerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    })
  ) {
    return null;
  }

  const normalized = value.trim().replace(/\s+/gu, " ");
  const length = Array.from(normalized).length;
  if (length === 0 || length > PLAYER_NAME_MAX_LENGTH) return null;

  return normalized;
}

export type CellState = "empty" | "ship" | "hit" | "miss" | "sunk" | "blocked";

export type Board = Record<Coordinate, CellState>;

export type Missile = {
  id: string;
  target: Coordinate;
  launchedAt: number;
  isIntercepted?: boolean;
};

// ── Room Settings ─────────────────────────────────────────────────────────────

export type BattleMode = "turn-based" | "async";
export type DifficultyMode = "beginner" | "normal" | "expert";

/** Minimum async reload for the legacy expert launch sound. */
export const MIN_ATTACK_COOLDOWN_MS = 2_000;
/**
 * Beginner/normal playback lasts at most 9,816 ms:
 * shooting (6,874) + flying (942) + boom (2,000). Round up to a full second
 * so a new shot cannot start before the previous audible sequence has ended.
 */
export const MIN_GUIDED_ATTACK_COOLDOWN_MS = 10_000;

export function minimumAttackCooldownMs(difficulty: DifficultyMode): number {
  return difficulty === "expert" ? MIN_ATTACK_COOLDOWN_MS : MIN_GUIDED_ATTACK_COOLDOWN_MS;
}

export type RoomSettings = {
  battleMode: BattleMode;
  /** Keep the correctly entered letter when only the digit is wrong. */
  difficulty: DifficultyMode;
  /** Async only: ms a player must wait after firing before next attack */
  attackCooldownMs: number;
  /** Ms window defender has to intercept an incoming missile */
  interceptWindowMs: number;
  /** Maximum intercept attempts per missile */
  maxInterceptAttempts: number;
};

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  battleMode: "turn-based",
  difficulty: "normal",
  attackCooldownMs: MIN_GUIDED_ATTACK_COOLDOWN_MS,
  interceptWindowMs: 25_000,
  maxInterceptAttempts: 3,
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Clamp untrusted lobby/WS settings to the live game contract. */
export function clampRoomSettings(raw: unknown): RoomSettings {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const difficulty =
    record.difficulty === "beginner" ||
    record.difficulty === "normal" ||
    record.difficulty === "expert"
      ? record.difficulty
      : record.beginnerMode === true
        ? "beginner"
        : DEFAULT_ROOM_SETTINGS.difficulty;
  const cooldownMin = minimumAttackCooldownMs(difficulty);
  return {
    battleMode: record.battleMode === "async" ? "async" : "turn-based",
    difficulty,
    attackCooldownMs: clampNumber(record.attackCooldownMs, cooldownMin, 60_000, cooldownMin),
    interceptWindowMs: clampNumber(
      record.interceptWindowMs,
      10_000,
      60_000,
      DEFAULT_ROOM_SETTINGS.interceptWindowMs,
    ),
    maxInterceptAttempts: clampNumber(
      record.maxInterceptAttempts,
      1,
      5,
      DEFAULT_ROOM_SETTINGS.maxInterceptAttempts,
    ),
  };
}
