"use client";
// apps/web/src/hooks/useGameLoop.ts
//
// FIX: Added ATTACK_COOLDOWN_UPDATE handler for async mode.
// When server sends cooldown info after missile resolves, we update
// store.attackCooldownExpiresAt so UI can show reload timer.

import {
  GameEventType,
  type Missile,
  type MorseSymbol,
} from "@radioboi/game-core";
import type { MorseEngine } from "@radioboi/morse-engine";
import { MORSE_REVERSE } from "@radioboi/morse-engine";
import { type RefObject, useEffect, useRef } from "react";
import type { RadarRef } from "@/src/components/RadarCanvas";
import type { GameClient } from "@/src/lib/network/gameClient";
import { formatCoordForLog, useGameStore } from "@/src/store/gameStore";

const INTERCEPT_WINDOW_MS = 25_000;
const DOT_UNIT = 1;
const DASH_UNIT = 3;
const ELEMENT_GAP = -1;
const CHARACTER_GAP = -3;

export type GameLoopRuntimeState = {
  incomingMissileAttempts: number;
  incomingMissileDeadline: number | null;
  incomingMissileId: string | null;
  incomingMissileMaxAttempts: number;
  incomingMissileSequence: number[] | null;
  lastInterceptWrong: boolean;
};

type GameStoreState = ReturnType<typeof useGameStore.getState>;
type RuntimeCarrier = GameStoreState & Partial<GameLoopRuntimeState>;

const DEFAULT_RUNTIME_STATE: GameLoopRuntimeState = {
  incomingMissileAttempts: 0,
  incomingMissileDeadline: null,
  incomingMissileId: null,
  incomingMissileMaxAttempts: 3,
  incomingMissileSequence: null,
  lastInterceptWrong: false,
};

function readRuntimeState(): GameLoopRuntimeState {
  const state = useGameStore.getState() as RuntimeCarrier;
  return {
    incomingMissileAttempts: state.incomingMissileAttempts ?? 0,
    incomingMissileDeadline: state.incomingMissileDeadline ?? null,
    incomingMissileId: state.incomingMissileId ?? null,
    incomingMissileMaxAttempts: state.incomingMissileMaxAttempts ?? 3,
    incomingMissileSequence: state.incomingMissileSequence ?? null,
    lastInterceptWrong: state.lastInterceptWrong ?? false,
  };
}

function encodeToken(token: string): number[] {
  const sequence: number[] = [];
  for (const [index, symbol] of [...token].entries()) {
    if (index > 0) sequence.push(ELEMENT_GAP);
    sequence.push(symbol === "." ? DOT_UNIT : DASH_UNIT);
  }
  return sequence;
}

function toPlaybackSequence(sequence: readonly MorseSymbol[]): number[] {
  const flat = sequence.join("");
  for (let splitAt = 1; splitAt < flat.length; splitAt++) {
    const left  = flat.slice(0, splitAt);
    const right = flat.slice(splitAt);
    if (MORSE_REVERSE[left] === undefined || MORSE_REVERSE[right] === undefined) continue;
    return [...encodeToken(left), CHARACTER_GAP, ...encodeToken(right)];
  }
  return encodeToken(flat);
}

function removeMissileFromStore(missileId: string): void {
  useGameStore.setState((state) => ({
    activeMissiles: state.activeMissiles.filter((m) => m.id !== missileId),
  }));
}

export function getGameLoopRuntimeState(): GameLoopRuntimeState {
  return readRuntimeState();
}

export function patchGameLoopRuntimeState(partial: Partial<GameLoopRuntimeState>): void {
  useGameStore.setState(partial as unknown as Partial<GameStoreState>);
}

export function resetGameLoopRuntimeState(): void {
  patchGameLoopRuntimeState(DEFAULT_RUNTIME_STATE);
}

export function useGameLoop(
  transport: GameClient | null,
  radarWorker: RefObject<RadarRef>,
  morseEngine: MorseEngine | null,
): () => void {
  const cleanupRef = useRef<VoidFunction>(() => {});

  useEffect(() => {
    if (!transport) {
      cleanupRef.current = () => {};
      return;
    }

    // ── INCOMING_MISSILE ──────────────────────────────────────────────────
    const stopIncoming = transport.on(GameEventType.INCOMING_MISSILE, (event) => {
      // Derive intercept window from current settings (may differ from default)
      const settings = useGameStore.getState().settings;
      const windowMs = settings?.interceptWindowMs ?? INTERCEPT_WINDOW_MS;

      const playbackSequence = toPlaybackSequence(event.payload.morseSequence);

      patchGameLoopRuntimeState({
        incomingMissileAttempts: 0,
        incomingMissileDeadline: Date.now() + windowMs,
        incomingMissileId: event.payload.missileId,
        incomingMissileMaxAttempts: event.payload.maxAttempts,
        incomingMissileSequence: playbackSequence,
        lastInterceptWrong: false,
      });

      void morseEngine?.playSequence(playbackSequence);
    });

    // ── RESOLVE_HIT ───────────────────────────────────────────────────────
    const stopResolve = transport.on(GameEventType.RESOLVE_HIT, (event) => {
      const runtime = readRuntimeState();
      const store   = useGameStore.getState();

      const isByThem = runtime.incomingMissileId === event.payload.missileId;
      const boardUpdater = isByThem ? store.applyOwnHit : store.applyEnemyShot;

      void radarWorker.current?.removeMissile(event.payload.missileId);
      removeMissileFromStore(event.payload.missileId);
      boardUpdater(event.payload.target, event.payload.result);

      store.addShotEntry({
        by: isByThem ? "them" : "us",
        coord: formatCoordForLog(event.payload.target),
        result: event.payload.result,
        ts: Date.now(),
      });

      if (event.payload.isGameOver) {
        store.setPhase("gameOver");
      }

      if (event.payload.result === "sunk") {
        void morseEngine?.playSequence(
          [DOT_UNIT, ELEMENT_GAP, DOT_UNIT, ELEMENT_GAP, DOT_UNIT],
          60,
        );
      }

      resetGameLoopRuntimeState();
    });

    // ── SYNC_STATE ────────────────────────────────────────────────────────
    const stopSync = transport.on(GameEventType.SYNC_STATE, (event) => {
      useGameStore.setState({
        activeMissiles: event.payload.activeMissiles as Missile[],
      });

      if (event.payload.activeMissiles.length === 0) {
        resetGameLoopRuntimeState();
      }
    });

    // ── ATTACK_COOLDOWN_UPDATE (async mode) ───────────────────────────────
    // Server sends this immediately after a missile resolves in async mode.
    // expiresAt is a unix ms timestamp when the player can fire again.
    const stopCooldown = transport.on(GameEventType.ATTACK_COOLDOWN_UPDATE, (event) => {
      useGameStore.getState().setAttackCooldown(event.payload.expiresAt);
    });

    // ── ERROR ─────────────────────────────────────────────────────────────
    const stopError = transport.on(GameEventType.ERROR, (event) => {
      if (event.payload.code === "MORSE_MISMATCH") {
        const runtime = readRuntimeState();
        if (runtime.incomingMissileId !== null) {
          patchGameLoopRuntimeState({ lastInterceptWrong: true });
          setTimeout(() => {
            patchGameLoopRuntimeState({ lastInterceptWrong: false });
          }, 700);
        }
      }
    });

    const cleanup = () => {
      stopIncoming();
      stopResolve();
      stopSync();
      stopCooldown();
      stopError();
      cleanupRef.current = () => {};
    };

    cleanupRef.current = cleanup;
    return cleanup;
  }, [morseEngine, radarWorker, transport]);

  return cleanupRef.current;
}
