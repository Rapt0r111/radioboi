// packages/game-core/src/types.ts

export type Coordinate = string & { readonly __brand: 'Coordinate' };

export type GamePhase = 'lobby' | 'placement' | 'battle' | 'gameOver';

export type CellState = 'empty' | 'ship' | 'hit' | 'miss' | 'sunk';

export type Board = Record<Coordinate, CellState>;

export type Missile = {
  id: string;
  target: Coordinate;
  launchedAt: number;
  isIntercepted?: boolean;
};