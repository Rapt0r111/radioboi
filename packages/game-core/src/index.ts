// packages/game-core/src/index.ts

// ── Coordinates ───────────────────────────────────────────────────────────────
export {
  COLUMNS,
  getAdjacentCoordinates,
  isValidCoordinate,
  makeCoordinate,
  parseCoordinate,
  ROWS,
} from "./coordinates.js";
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
} from "./network-types.js";
// ── Network types ─────────────────────────────────────────────────────────────
export {
  ErrorCode,
  GameEventType,
} from "./network-types.js";

export type { PlacementError, PlacementResult } from "./ship-placement.js";
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
  validatePlacement,
} from "./ship-placement.js";
// ── Core types ────────────────────────────────────────────────────────────────
export type { Board, CellState, Coordinate, GamePhase, Missile } from "./types.js";
