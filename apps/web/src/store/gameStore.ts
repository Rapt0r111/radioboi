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
  /** Установить фазу игры */
  setPhase(phase: GamePhase): void;

  /** Установить идентификаторы сессии */
  setSession(playerId: string, roomId: string): void;

  /** Разместить корабль: отмечает список координат как 'ship' на собственном поле */
  placeShip(coords: Coordinate[]): void;

  /**
   * Зарегистрировать входящую ракету противника.
   * Используется сетевым слоем, когда приходит событие «missile launched».
   */
  addMissile(missile: Missile): void;

  /**
   * Применить результат выстрела на поле противника
   * (используется после успешной передачи координат по Морзе).
   */
  applyEnemyShot(coord: Coordinate, result: 'hit' | 'miss' | 'sunk'): void;

  /**
   * Применить результат входящего выстрела на собственном поле.
   * Вызывается после декодирования координат и проверки на сервере.
   */
  applyOwnHit(coord: Coordinate, result: 'hit' | 'miss' | 'sunk'): void;

  /** Пометить ракету как перехваченную */
  interceptMissile(missileId: string): void;

  /** Передать ход */
  toggleTurn(): void;

  /** Полный сброс в начальное состояние */
  reset(): void;
};

type GameStore = GameState & GameActions;

// ── Начальное состояние ───────────────────────────────────────────────────────

const INITIAL_STATE: GameState = {
  phase:          'lobby',
  playerId:       null,
  roomId:         null,
  ownBoard:       {},
  enemyBoard:     {},
  activeMissiles: [],
  isMyTurn:       false,
};

// ── Стор ─────────────────────────────────────────────────────────────────────

export const useGameStore = create<GameStore>((set) => ({
  ...INITIAL_STATE,

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

  applyEnemyShot(coord, result) {
    set((state) => ({
      enemyBoard: {
        ...state.enemyBoard,
        [coord]: result === 'sunk' ? 'sunk' : result === 'hit' ? 'hit' : 'miss',
      },
    }));
  },

  applyOwnHit(coord, result) {
    set((state) => ({
      ownBoard: {
        ...state.ownBoard,
        [coord]: result === 'sunk' ? 'sunk' : result === 'hit' ? 'hit' : 'miss',
      },
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
    set(INITIAL_STATE);
  },
}));

// ── Селекторы (стабильные ссылки, не требуют мемоизации при React Compiler) ──

export const selectPhase          = (s: GameStore) => s.phase;
export const selectOwnBoard       = (s: GameStore) => s.ownBoard;
export const selectEnemyBoard     = (s: GameStore) => s.enemyBoard;
export const selectActiveMissiles = (s: GameStore) => s.activeMissiles;
export const selectIsMyTurn       = (s: GameStore) => s.isMyTurn;