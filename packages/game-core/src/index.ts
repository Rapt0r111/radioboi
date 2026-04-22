// packages/game-core/src/index.ts

// ── Core types ────────────────────────────────────────────────────────────────
export type { Coordinate, GamePhase, CellState, Board, Missile } from './types.js';

// ── Coordinates ───────────────────────────────────────────────────────────────
export {
  COLUMNS,
  ROWS,
  isValidCoordinate,
  makeCoordinate,
  parseCoordinate,
  getAdjacentCoordinates,
} from './coordinates.js';

// ── Ship placement ────────────────────────────────────────────────────────────
export {
  REQUIRED_FLEET,
  FLEET_TOTAL_CELLS,
  validatePlacement,
  buildBoardFromShips,
  buildShipSets,
  isShipSunk,
  isFleetDestroyed,
  findShipAt,
  colIndexToMorseLetter,
  morseLetterToColIndex,
  coordinateToMorseNotation,
  morseNotationToCoordinate,
} from './ship-placement.js';

export type { PlacementError, PlacementResult } from './ship-placement.js';

// ── Network types ─────────────────────────────────────────────────────────────
export {
  GameEventType,
  ErrorCode,
} from './network-types.js';

export type {
  MorseSymbol,
  MorseSequence,
  GameEvent,
  ClientGameEvent,
  ServerGameEvent,
  JoinRoomEvent,
  ShipsPlacedEvent,
  AttackPrepEvent,
  MissileLaunchedEvent,
  InterceptAttemptEvent,
  PlayerJoinedEvent,
  GameStartedEvent,
  IncomingMissileEvent,
  HitResult,
  ResolveHitEvent,
  SyncStateEvent,
  ErrorEvent,
} from './network-types.js';