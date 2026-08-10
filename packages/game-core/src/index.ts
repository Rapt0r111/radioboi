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

export {
  ErrorCode,
  FATAL_WS_CLOSE_CODE,
  FatalCloseReason,
  GameEventType,
  messageForFatalCloseReason,
} from "./network-types";

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

export type {
  BattleMode,
  Board,
  CellState,
  Coordinate,
  DifficultyMode,
  GamePhase,
  Missile,
  PlayerSummary,
  RoomSettings,
} from "./types";
export {
  ATTACKER_TURN_TIMEOUT_MS,
  DEFAULT_ROOM_SETTINGS,
  makeLocalPlayerSummary,
  MIN_ATTACK_COOLDOWN_MS,
  MIN_GUIDED_ATTACK_COOLDOWN_MS,
  minimumAttackCooldownMs,
  normalizePlayerName,
  PLAYER_NAME_MAX_LENGTH,
  RECONNECT_BUDGET_MS,
} from "./types";
