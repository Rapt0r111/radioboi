// apps/web/src/store/gameStore.ts
'use client';

import { create } from 'zustand';
import type { Board, Coordinate, GamePhase, Missile } from '@radioboi/game-core';

// ── Типы ─────────────────────────────────────────────────────────────────────

type GameState = {
  phase:          GamePhase;
  playerId:       string | null;
  roomId:         string | null;
  ownBoard:       Board;
  enemyBoard:     Board;
  activeMissiles: Missile[];
  isMyTurn:       boolean;
};

type GameActions = {
  setPhase(phase: GamePhase): void;
  setSession(playerId: string, roomId: string): void;
  placeShip(coords: Coordinate[]): void;
  addMissile(missile: Missile): void;
  applyEnemyShot(coord: Coordinate, result: 'hit' | 'miss' | 'sunk'): void;
  applyOwnHit(coord: Coordinate, result: 'hit' | 'miss' | 'sunk'): void;
  interceptMissile(missileId: string): void;
  toggleTurn(): void;
  reset(): void;
};

type GameStore = GameState & GameActions;

// ── Фабрика начального состояния (новый объект при каждом вызове) ─────────────

function makeInitialState(): GameState {
  return {
    phase:          'lobby',
    playerId:       null,
    roomId:         null,
    ownBoard:       {},
    enemyBoard:     {},
    activeMissiles: [],
    isMyTurn:       false,
  };
}

// ── Стор ─────────────────────────────────────────────────────────────────────

export const useGameStore = create<GameStore>((set) => ({
  ...makeInitialState(),

  setPhase(phase) {
    set({ phase });
  },

  setSession(playerId, roomId) {
    set({ playerId, roomId });
  },

  placeShip(coords) {
    set((state) => {
      const next: Board = { ...state.ownBoard };
      for (const coord of coords) {
        next[coord] = 'ship';
      }
      return { ownBoard: next };
    });
  },

  addMissile(missile) {
    set((state) => ({
      activeMissiles: [...state.activeMissiles, missile],
    }));
  },

  // result уже является подтипом CellState — прямое присваивание корректно
  applyEnemyShot(coord, result) {
    set((state) => ({
      enemyBoard: { ...state.enemyBoard, [coord]: result },
    }));
  },

  applyOwnHit(coord, result) {
    set((state) => ({
      ownBoard: { ...state.ownBoard, [coord]: result },
    }));
  },

  interceptMissile(missileId) {
    set((state) => ({
      activeMissiles: state.activeMissiles.map((m) =>
        m.id === missileId ? { ...m, isIntercepted: true } : m,
      ),
    }));
  },

  toggleTurn() {
    set((state) => ({ isMyTurn: !state.isMyTurn }));
  },

  reset() {
    set(makeInitialState());
  },
}));

// ── Селекторы ─────────────────────────────────────────────────────────────────

export const selectPhase          = (s: GameStore) => s.phase;
export const selectOwnBoard       = (s: GameStore) => s.ownBoard;
export const selectEnemyBoard     = (s: GameStore) => s.enemyBoard;
export const selectActiveMissiles = (s: GameStore) => s.activeMissiles;
export const selectIsMyTurn       = (s: GameStore) => s.isMyTurn;