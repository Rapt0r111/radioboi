// apps/web/src/store/gameStore.ts
"use client";

import type { Board, Coordinate, GamePhase, Missile } from "@radioboi/game-core";
import { create } from "zustand";

// ── Типы ──────────────────────────────────────────────────────────────────────

/**
 * Запись об одном выстреле для истории ходов.
 * by: "us" — мы стреляли, "them" — стрелял противник.
 */
export type ShotLogEntry = {
  by: "us" | "them";
  coord: string;   // читаемая координата для отображения (например "B5")
  result: "hit" | "miss" | "sunk";
  ts: number;
};

type GameState = {
  phase: GamePhase;
  playerId: string | null;
  roomId: string | null;
  ownBoard: Board;
  enemyBoard: Board;
  activeMissiles: Missile[];
  isMyTurn: boolean;
  winnerId: string | null;
  shotLog: ShotLogEntry[];
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
  /** Добавляет запись в историю ходов */
  addShotEntry(entry: ShotLogEntry): void;
  reset(): void;
};

type GameStore = GameState & GameActions;

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
    shotLog: [],
  };
}

// ── Хелпер: читаемая координата из branded Coordinate ──────────────────────────
// Coordinate = "АБВ005" → отображаем как "АБВ-5" для компактности
function formatCoordForLog(coord: Coordinate): string {
  // Слог (3 символа) + разряд (3 символа "005") → "АБВ-5"
  const col = coord.slice(0, 3);
  const rowNum = Number(coord.slice(3, 6));
  return `${col}-${rowNum}`;
}

export const useGameStore = create<GameStore>((set) => ({
  ...makeInitialState(),

  setPhase(phase) { set({ phase }); },
  setSession(playerId, roomId) { set({ playerId, roomId }); },

  placeShip(coords) {
    set((state) => {
      const next: Board = { ...state.ownBoard };
      for (const coord of coords) next[coord] = "ship";
      return { ownBoard: next };
    });
  },

  addMissile(missile) {
    set((state) => ({ activeMissiles: [...state.activeMissiles, missile] }));
  },

  applyEnemyShot(coord, result) {
    set((state) => ({ enemyBoard: { ...state.enemyBoard, [coord]: result } }));
  },

  applyOwnHit(coord, result) {
    set((state) => ({ ownBoard: { ...state.ownBoard, [coord]: result } }));
  },

  interceptMissile(missileId) {
    set((state) => ({
      activeMissiles: state.activeMissiles.map((m) =>
        m.id === missileId ? { ...m, isIntercepted: true } : m,
      ),
    }));
  },

  toggleTurn() { set((state) => ({ isMyTurn: !state.isMyTurn })); },

  syncFromServer({ phase, ownBoard, enemyBoard, isMyTurn, winnerId }) {
    set({ phase, ownBoard, enemyBoard, isMyTurn, winnerId: winnerId ?? null });
  },

  addShotEntry(entry) {
    set((state) => ({ shotLog: [...state.shotLog, entry] }));
  },

  reset() { set(makeInitialState()); },
}));

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectPhase = (s: GameStore) => s.phase;
export const selectOwnBoard = (s: GameStore) => s.ownBoard;
export const selectEnemyBoard = (s: GameStore) => s.enemyBoard;
export const selectActiveMissiles = (s: GameStore) => s.activeMissiles;
export const selectIsMyTurn = (s: GameStore) => s.isMyTurn;
export const selectWinnerId = (s: GameStore) => s.winnerId;
export const selectShotLog = (s: GameStore) => s.shotLog;

export { formatCoordForLog };