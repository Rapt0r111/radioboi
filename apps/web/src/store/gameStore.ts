// apps/web/src/store/gameStore.ts
"use client";

import type { Board, Coordinate, GamePhase, Missile } from "@radioboi/game-core";
import { create } from "zustand";

// ── Типы ─────────────────────────────────────────────────────────────────────

type GameState = {
  phase: GamePhase;
  playerId: string | null;
  roomId: string | null;
  ownBoard: Board;
  enemyBoard: Board;
  activeMissiles: Missile[];
  isMyTurn: boolean;
  winnerId: string | null; // NEW: хранит ID победителя
};

type SyncSnapshot = {
  phase: GamePhase;
  ownBoard: Board;
  enemyBoard: Board;
  isMyTurn: boolean;
  winnerId?: string | undefined;
};

type GameActions = {
  setPhase(phase: GamePhase): void;
  setSession(playerId: string, roomId: string): void;
  placeShip(coords: Coordinate[]): void;
  addMissile(missile: Missile): void;
  applyEnemyShot(coord: Coordinate, result: "hit" | "miss" | "sunk"): void;
  applyOwnHit(coord: Coordinate, result: "hit" | "miss" | "sunk"): void;
  interceptMissile(missileId: string): void;
  toggleTurn(): void;
  syncFromServer(snapshot: SyncSnapshot): void;
  reset(): void;
};

type GameStore = GameState & GameActions;

// ── Начальное состояние ───────────────────────────────────────────────────────

function makeInitialState(): GameState {
  return {
    phase: "lobby",
    playerId: null,
    roomId: null,
    ownBoard: {} as Board,
    enemyBoard: {} as Board,
    activeMissiles: [],
    isMyTurn: false,
    winnerId: null,
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
        next[coord] = "ship";
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

  // Полная синхронизация от сервера (SYNC_STATE).
  // Сохраняет winnerId если он присутствует в снапшоте.
  syncFromServer({ phase, ownBoard, enemyBoard, isMyTurn, winnerId }) {
    set({
      phase,
      ownBoard,
      enemyBoard,
      isMyTurn,
      ...(winnerId !== undefined ? { winnerId } : {}),
    });
  },

  reset() {
    set(makeInitialState());
  },
}));

// ── Селекторы ─────────────────────────────────────────────────────────────────

export const selectPhase = (s: GameStore) => s.phase;
export const selectOwnBoard = (s: GameStore) => s.ownBoard;
export const selectEnemyBoard = (s: GameStore) => s.enemyBoard;
export const selectActiveMissiles = (s: GameStore) => s.activeMissiles;
export const selectIsMyTurn = (s: GameStore) => s.isMyTurn;
export const selectWinnerId = (s: GameStore) => s.winnerId;