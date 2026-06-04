"use client";
// apps/web/src/store/gameStore.ts
//
// FIX (HIGH): SyncSnapshot теперь включает shotLog, settings, attackCooldownExpiresAt.
// syncFromServer восстанавливает историю при реконнекте и синхронизирует
// настройки комнаты и cooldown для async-режима.

import type { Board, Coordinate, GamePhase, Missile, RoomSettings } from "@radioboi/game-core";
import { DEFAULT_ROOM_SETTINGS } from "@radioboi/game-core";
import { create } from "zustand";

// ── Типы ──────────────────────────────────────────────────────────────────────

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
  /** Room settings received from server via SYNC_STATE */
  settings: RoomSettings;
  /**
   * Async mode: unix ms when this player can attack again.
   * null = not on cooldown / turn-based mode.
   */
  attackCooldownExpiresAt: number | null;
};

type SyncSnapshot = {
  phase: GamePhase;
  ownBoard: Board;
  enemyBoard: Board;
  isMyTurn: boolean;
  winnerId?: string | undefined;
  shotLog?: ShotLogEntry[] | undefined;
  settings?: RoomSettings | undefined;
  /** 0 means cooldown has expired / not applicable */
  attackCooldownExpiresAt?: number | undefined;
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
  addShotEntry(entry: ShotLogEntry): void;
  /** Called on ATTACK_COOLDOWN_UPDATE event (async mode) */
  setAttackCooldown(expiresAt: number): void;
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
    settings: { ...DEFAULT_ROOM_SETTINGS },
    attackCooldownExpiresAt: null,
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

  syncFromServer({ phase, ownBoard, enemyBoard, isMyTurn, winnerId, shotLog, settings, attackCooldownExpiresAt }) {
    set((state) => ({
      phase,
      ownBoard,
      enemyBoard,
      isMyTurn,
      winnerId: winnerId ?? null,
      // Merge shotLog: keep server's if longer (reconnect restore)
      shotLog:
        shotLog !== undefined && shotLog.length > state.shotLog.length
          ? shotLog
          : state.shotLog,
      // Always update settings when server sends them
      settings: settings ?? state.settings,
      // attackCooldownExpiresAt: 0 from server means "not on cooldown"
      attackCooldownExpiresAt:
        attackCooldownExpiresAt !== undefined && attackCooldownExpiresAt > 0
          ? attackCooldownExpiresAt
          : attackCooldownExpiresAt === 0
            ? null
            : state.attackCooldownExpiresAt,
    }));
  },

  addShotEntry(entry) {
    set((state) => ({ shotLog: [...state.shotLog, entry] }));
  },

  setAttackCooldown(expiresAt) {
    set({ attackCooldownExpiresAt: expiresAt > Date.now() ? expiresAt : null });
  },

  reset() { set(makeInitialState()); },
}));

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectPhase            = (s: GameStore) => s.phase;
export const selectOwnBoard         = (s: GameStore) => s.ownBoard;
export const selectEnemyBoard       = (s: GameStore) => s.enemyBoard;
export const selectActiveMissiles   = (s: GameStore) => s.activeMissiles;
export const selectIsMyTurn         = (s: GameStore) => s.isMyTurn;
export const selectWinnerId         = (s: GameStore) => s.winnerId;
export const selectShotLog          = (s: GameStore) => s.shotLog;
export const selectSettings         = (s: GameStore) => s.settings;
export const selectCooldownExpiresAt = (s: GameStore) => s.attackCooldownExpiresAt;

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatCoordForLog(coord: Coordinate): string {
  const col = coord.slice(0, 3);
  const rowNum = Number(coord.slice(3, 6));
  return `${col}-${rowNum}`;
}
