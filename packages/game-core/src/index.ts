// packages/game-core/src/index.ts

export type { Coordinate, GamePhase, CellState, Board, Missile } from './types.js';

export {
  COLUMNS,
  ROWS,
  isValidCoordinate,
  makeCoordinate,
  parseCoordinate,
  getAdjacentCoordinates,
} from './coordinates.js';