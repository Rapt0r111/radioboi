"use client";
// apps/web/src/store/gameStore.ts
//
// FIX (HIGH): SyncSnapshot теперь включает shotLog, settings, attackCooldownExpiresAt.
// syncFromServer восстанавливает историю при реконнекте и синхронизирует
// настройки комнаты и cooldown для async-режима.

import type {
  Board,
  Coordinate,
  GamePhase,
  Missile,
  PlayerSummary,
  RoomSettings,
} from "@radioboi/game-core";
import {
  BOARD_COLUMN_LABELS,
  BOARD_ROW_LABELS,
  DEFAULT_ROOM_SETTINGS,
  parseCoordinate,
} from "@radioboi/game-core";
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
  playerName: string;
  roomId: string | null;
  players: PlayerSummary[];
  ownBoard: Board;
  enemyBoard: Board;
  activeMissiles: Missile[];
  /** Absolute browser times when cell impact VFX should become visible. */
  impactVfxStartsAt: Record<string, number>;
  /** Number of guided results whose authoritative snapshot is still hidden. */
  deferredRevealCount: number;
  deferredSyncSnapshot: SyncSnapshot | null;
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
  activeMissiles?: Missile[] | undefined;
  isMyTurn: boolean;
  winnerId?: string | undefined;
  shotLog?: ShotLogEntry[] | undefined;
  settings?: RoomSettings | undefined;
  players?: PlayerSummary[] | undefined;
  /** 0 means cooldown has expired / not applicable */
  attackCooldownExpiresAt?: number | undefined;
};

function cooldownFromSnapshot(
  current: number | null,
  expiresAt: number | undefined,
): number | null {
  if (expiresAt !== undefined && expiresAt > 0) return expiresAt;
  if (expiresAt === 0) return null;
  return current;
}

function syncStatePatch(state: GameState, snapshot: SyncSnapshot): Partial<GameState> {
  return {
    phase: snapshot.phase,
    ownBoard: snapshot.ownBoard,
    enemyBoard: snapshot.enemyBoard,
    activeMissiles: snapshot.activeMissiles ?? state.activeMissiles,
    isMyTurn: snapshot.isMyTurn,
    winnerId: snapshot.winnerId ?? null,
    players: snapshot.players ?? state.players,
    // Server snapshot is perspective-correct for this player; replace local optimistic log.
    shotLog: snapshot.shotLog ?? state.shotLog,
    settings: snapshot.settings ?? state.settings,
    attackCooldownExpiresAt: cooldownFromSnapshot(
      state.attackCooldownExpiresAt,
      snapshot.attackCooldownExpiresAt,
    ),
  };
}

type GameActions = {
  setPhase(phase: GamePhase): void;
  setSession(playerId: string, roomId: string, playerName?: string): void;
  upsertPlayer(player: PlayerSummary): void;
  placeShip(coords: Coordinate[]): void;
  addMissile(missile: Missile): void;
  removeMissile(missileId: string): void;
  applyEnemyShot(coord: Coordinate, result: "hit" | "miss" | "sunk"): void;
  applyOwnHit(coord: Coordinate, result: "hit" | "miss" | "sunk"): void;
  interceptMissile(missileId: string): void;
  toggleTurn(): void;
  syncFromServer(snapshot: SyncSnapshot): void;
  addShotEntry(entry: ShotLogEntry): void;
  /** Called on ATTACK_COOLDOWN_UPDATE event (async mode) */
  setAttackCooldown(expiresAt: number): void;
  scheduleImpactVfx(key: string, startsAt: number): void;
  beginRevealDelay(): void;
  releaseRevealDelay(): void;
  reset(): void;
};

type GameStore = GameState & GameActions;

function makeInitialState(): GameState {
  return {
    phase: "lobby",
    playerId: null,
    playerName: "",
    roomId: null,
    players: [],
    ownBoard: {} as Board,
    enemyBoard: {} as Board,
    activeMissiles: [],
    impactVfxStartsAt: {},
    deferredRevealCount: 0,
    deferredSyncSnapshot: null,
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
  setSession(playerId, roomId, playerName = "") {
    set({
      playerId,
      playerName,
      roomId,
      players: [{ id: playerId, name: playerName }],
    });
  },

  upsertPlayer(player) {
    set((state) => ({
      players: state.players.some((entry) => entry.id === player.id)
        ? state.players.map((entry) => (entry.id === player.id ? player : entry))
        : [...state.players, player],
      ...(player.id === state.playerId ? { playerName: player.name } : {}),
    }));
  },

  placeShip(coords) {
    set((state) => {
      const next: Board = { ...state.ownBoard };
      for (const coord of coords) next[coord] = "ship";
      return { ownBoard: next };
    });
  },

  addMissile(missile) {
    set((state) => ({
      activeMissiles: state.activeMissiles.some((entry) => entry.id === missile.id)
        ? state.activeMissiles.map((entry) => entry.id === missile.id ? missile : entry)
        : [...state.activeMissiles, missile],
    }));
  },

  removeMissile(missileId) {
    set((state) => ({
      activeMissiles: state.activeMissiles.filter((missile) => missile.id !== missileId),
    }));
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

  syncFromServer(snapshot) {
    set((state) => {
      if (state.deferredRevealCount > 0) {
        return {
          deferredSyncSnapshot: snapshot,
          // Cooldown/settings are safe to update while board results remain hidden.
          settings: snapshot.settings ?? state.settings,
          players: snapshot.players ?? state.players,
          attackCooldownExpiresAt: cooldownFromSnapshot(
            state.attackCooldownExpiresAt,
            snapshot.attackCooldownExpiresAt,
          ),
        };
      }
      return syncStatePatch(state, snapshot);
    });
  },

  addShotEntry(entry) {
    set((state) => ({ shotLog: [...state.shotLog, entry] }));
  },

  setAttackCooldown(expiresAt) {
    set({ attackCooldownExpiresAt: expiresAt > Date.now() ? expiresAt : null });
  },

  scheduleImpactVfx(key, startsAt) {
    set((state) => ({
      impactVfxStartsAt: { ...state.impactVfxStartsAt, [key]: startsAt },
    }));
  },

  beginRevealDelay() {
    set((state) => ({ deferredRevealCount: state.deferredRevealCount + 1 }));
  },

  releaseRevealDelay() {
    set((state) => {
      const deferredRevealCount = Math.max(0, state.deferredRevealCount - 1);
      if (deferredRevealCount > 0) return { deferredRevealCount };

      const snapshot = state.deferredSyncSnapshot;
      if (snapshot === null) {
        return { deferredRevealCount, deferredSyncSnapshot: null };
      }

      return {
        ...syncStatePatch(state, snapshot),
        deferredRevealCount,
        deferredSyncSnapshot: null,
      };
    });
  },

  reset() { set(makeInitialState()); },
}));

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectPhase            = (s: GameStore) => s.phase;
export const selectPlayerName       = (s: GameStore) => s.playerName;
export const selectPlayers          = (s: GameStore) => s.players;
export const selectOwnBoard         = (s: GameStore) => s.ownBoard;
export const selectEnemyBoard       = (s: GameStore) => s.enemyBoard;
export const selectActiveMissiles   = (s: GameStore) => s.activeMissiles;
export const selectIsMyTurn         = (s: GameStore) => s.isMyTurn;
export const selectWinnerId         = (s: GameStore) => s.winnerId;
export const selectShotLog          = (s: GameStore) => s.shotLog;
export const selectSettings         = (s: GameStore) => s.settings;
export const selectCooldownExpiresAt = (s: GameStore) => s.attackCooldownExpiresAt;

// ── Display names ─────────────────────────────────────────────────────────────

const DEFAULT_SELF_NAME = "Вы";
const DEFAULT_OPPONENT_NAME = "Соперник";

function cleanDisplayName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Local player's nickname for UI labels. */
export function getSelfDisplayName(
  state: Pick<GameState, "playerName">,
  fallback: string = DEFAULT_SELF_NAME,
): string {
  return cleanDisplayName(state.playerName) ?? fallback;
}

/** Opponent nickname from the room roster, if known. */
export function getOpponentDisplayName(
  state: Pick<GameState, "playerId" | "players">,
  fallback: string = DEFAULT_OPPONENT_NAME,
): string {
  const opponent = state.players.find((player) => player.id !== state.playerId);
  return cleanDisplayName(opponent?.name) ?? fallback;
}

/** Winner nickname for game-over banners. */
export function getWinnerDisplayName(
  state: Pick<GameState, "playerId" | "playerName" | "players" | "winnerId">,
): string | null {
  if (state.winnerId === null) return null;
  if (state.winnerId === state.playerId) return getSelfDisplayName(state);

  const fromRoster = state.players.find((player) => player.id === state.winnerId);
  return cleanDisplayName(fromRoster?.name) ?? getOpponentDisplayName(state);
}

export const selectSelfDisplayName = (s: GameStore) => getSelfDisplayName(s);
export const selectOpponentDisplayName = (s: GameStore) => getOpponentDisplayName(s);
export const selectWinnerDisplayName = (s: GameStore) => getWinnerDisplayName(s);

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatCoordForLog(coord: Coordinate): string {
  const { colIndex, rowIndex } = parseCoordinate(coord);
  const rowLabel = BOARD_ROW_LABELS[rowIndex] ?? String(rowIndex + 1);
  const colLabel = BOARD_COLUMN_LABELS[colIndex] ?? String(colIndex + 1);
  return `${rowLabel}${colLabel}`;
}
