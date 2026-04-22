// apps/web/src/store/gameStore.ts
// PATCHED: added syncFromServer action for [FIX #3]
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
  // [FIX #3] — authoritative snapshot from server (SYNC_STATE).
  // Replaces boards, phase, and turn flag atomically so the client stays
  // consistent after reconnect or any phase transition.
  syncFromServer(snapshot: SyncSnapshot): void;
  reset(): void;
};

type GameStore = GameState & GameActions;

// ── Фабрика начального состояния ─────────────────────────────────────────────

function makeInitialState(): GameState {
  return {
    phase: "lobby",
    playerId: null,
    roomId: null,
    ownBoard: {} as Board,
    enemyBoard: {} as Board,
    activeMissiles: [],
    isMyTurn: false,
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

  // [FIX #3] — full authoritative sync from SYNC_STATE server event.
  // Overwrites boards and turn flag in a single atomic update.
  syncFromServer({ phase, ownBoard, enemyBoard, isMyTurn }) {
    set({ phase, ownBoard, enemyBoard, isMyTurn });
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
