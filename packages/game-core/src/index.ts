// packages/game-core/src/index.ts

// ── Coordinates ───────────────────────────────────────────────────────────────
export {
  COLUMNS,
  getAdjacentCoordinates,
  isValidCoordinate,
  makeCoordinate,
  parseCoordinate,
  ROWS,
} from "./coordinates";
export type {
  AttackPrepEvent,
  ClientGameEvent,
  ErrorEvent,
  GameEvent,
  GameStartedEvent,
  HitResult,
  IncomingMissileEvent,
  InterceptAttemptEvent,
  JoinRoomEvent,
  MissileLaunchedEvent,
  MorseSequence,
  MorseSymbol,
  PlayerJoinedEvent,
  ResolveHitEvent,
  ServerGameEvent,
  ShipsPlacedEvent,
  SyncStateEvent,
} from "./network-types";
// ── Network types ─────────────────────────────────────────────────────────────
export {
  ErrorCode,
  GameEventType,
} from "./network-types";

export type { PlacementError, PlacementResult } from "./ship-placement";
// ── Ship placement ────────────────────────────────────────────────────────────
export {
  buildBoardFromShips,
  buildShipSets,
  colIndexToMorseLetter,
  coordinateToMorseNotation,
  FLEET_TOTAL_CELLS,
  findShipAt,
  isFleetDestroyed,
  isShipSunk,
  morseLetterToColIndex,
  morseNotationToCoordinate,
  REQUIRED_FLEET,
  validateGeometry,   // ← NEW: geometry-only for mid-placement checks
  validatePlacement,  // ← full check for final Ready button
} from "./ship-placement";
// ── Core types ────────────────────────────────────────────────────────────────
export type { Board, CellState, Coordinate, GamePhase, Missile } from "./types";