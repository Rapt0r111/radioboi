// packages/game-core/src/index.ts

export {
  BOARD_COLUMN_LABELS,
  BOARD_ROW_LABELS,
  COLUMN_MORSE_DIGITS,
  COLUMNS,
  getAdjacentCoordinates,
  isValidCoordinate,
  makeCoordinate,
  parseCoordinate,
  ROWS,
} from "./coordinates";

export type {
  AttackCooldownUpdateEvent,
  AttackPrepEvent,
  ClientGameEvent,
  ClientShotLogEntry,
  ErrorEvent,
  GameEvent,
  GameStartedEvent,
  HitResult,
  IncomingMissileEvent,
  InterceptAttemptEvent,
  JoinRoomEvent,
  MissileLaunchedEvent,
  MissileInterceptedEvent,
  MorseSequence,
  MorseSymbol,
  PlayerJoinedEvent,
  ResolveHitEvent,
  ServerGameEvent,
  ShipsPlacedEvent,
  SyncStateEvent,
} from "./network-types";

export { ErrorCode, GameEventType } from "./network-types";

export type { PlacementError, PlacementResult } from "./ship-placement";
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
  validateGeometry,
  validatePlacement,
} from "./ship-placement";

export type { BattleMode, Board, CellState, Coordinate, GamePhase, Missile, RoomSettings } from "./types";
export { DEFAULT_ROOM_SETTINGS } from "./types";
