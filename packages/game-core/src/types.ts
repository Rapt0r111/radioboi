// packages/game-core/src/types.ts

export type Coordinate = string & { readonly __brand: "Coordinate" };

export type GamePhase = "lobby" | "placement" | "battle" | "gameOver";

export type CellState = "empty" | "ship" | "hit" | "miss" | "sunk";

export type Board = Record<Coordinate, CellState>;

export type Missile = {
  id: string;
  target: Coordinate;
  launchedAt: number;
  isIntercepted?: boolean;
};

// ── Room Settings ─────────────────────────────────────────────────────────────

export type BattleMode = "turn-based" | "async";

export type RoomSettings = {
  battleMode: BattleMode;
  /** Async only: ms a player must wait after firing before next attack */
  attackCooldownMs: number;
  /** Ms window defender has to intercept an incoming missile */
  interceptWindowMs: number;
  /** Maximum intercept attempts per missile */
  maxInterceptAttempts: number;
};

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  battleMode: "turn-based",
  attackCooldownMs: 2_000,
  interceptWindowMs: 25_000,
  maxInterceptAttempts: 3,
};
