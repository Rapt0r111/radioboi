// apps/web/src/store/gameStore.ts
"use client";
//
// FIX (HIGH): SyncSnapshot теперь включает shotLog из SYNC_STATE.
// syncFromServer восстанавливает историю при реконнекте: если сервер прислал
// более длинный лог — берём его; если живой лог длиннее (нормальная игра) —
// оставляем текущий. Это предотвращает затирание лога при каждом SYNC_STATE.

import type { Board, Coordinate, GamePhase, Missile } from "@radioboi/game-core";
import { create } from "zustand";

// ── Типы ──────────────────────────────────────────────────────────────────────

/**
 * Запись об одном выстреле для истории ходов.
 * by: "us" — мы стреляли, "them" — стрелял противник.
 */
export type ShotLogEntry = {
  by: "us" | "them";
  coord: string;
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

/**
 * FIX: Добавлено поле shotLog — история выстрелов из SYNC_STATE.
 * Опционально для обратной совместимости (старые SYNC_STATE без shotLog).
 */
type SyncSnapshot = {
  phase: GamePhase;
  ownBoard: Board;
  enemyBoard: Board;
  isMyTurn: boolean;
  winnerId?: string | undefined;
  shotLog?: ShotLogEntry[] | undefined;
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

  /**
   * FIX (HIGH): Восстанавливает историю выстрелов из серверного снапшота.
   *
   * Логика мержа shotLog:
   * - Если сервер прислал более длинный лог (реконнект после нескольких ходов)
   *   → берём серверный (восстановление истории).
   * - Если живой лог не короче серверного (нормальная игра, SYNC_STATE после
   *   каждого RESOLVE_HIT) → оставляем текущий.
   *
   * Это предотвращает двойную запись при нормальной игре:
   * addShotEntry уже добавил запись → SYNC_STATE приходит с тем же количеством
   * → мерж не перезаписывает (lengths equal → keep current).
   */
  syncFromServer({ phase, ownBoard, enemyBoard, isMyTurn, winnerId, shotLog }) {
    set((state) => ({
      phase,
      ownBoard,
      enemyBoard,
      isMyTurn,
      winnerId: winnerId ?? null,
      shotLog:
        shotLog !== undefined && shotLog.length > state.shotLog.length
          ? shotLog
          : state.shotLog,
    }));
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "АБВ005" → "АБВ-5" для отображения в истории ходов */
export function formatCoordForLog(coord: Coordinate): string {
  const col = coord.slice(0, 3);
  const rowNum = Number(coord.slice(3, 6));
  return `${col}-${rowNum}`;
}