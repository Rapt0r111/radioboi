// packages/game-core/src/types.ts

export type Coordinate = string & { readonly __brand: "Coordinate" };

export type GamePhase = "lobby" | "placement" | "battle" | "gameOver";

export type PlayerSummary = {
  id: string;
  name: string;
};

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
