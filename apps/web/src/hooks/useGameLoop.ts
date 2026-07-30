"use client";
// apps/web/src/hooks/useGameLoop.ts
//
// FIX: Added ATTACK_COOLDOWN_UPDATE handler for async mode.
// When server sends cooldown info after missile resolves, we update
// store.attackCooldownExpiresAt so UI can show reload timer.

import {
  GameEventType,
  type MorseSymbol,
  parseCoordinate,
  type Coordinate,
} from "@radioboi/game-core";
import {
  MORSE_REVERSE,
  type BattleSoundEffect,
  type GuidedMissileTimeline,
  type MorseEngine,
} from "@radioboi/morse-engine";
import { type RefObject, useEffect, useRef } from "react";
import type { RadarRef } from "@/src/components/RadarCanvas";
import type { GameClient } from "@/src/lib/network/gameClient";
import { decodeBoardMorseSequence } from "@/src/lib/morseInput";
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
  incomingMissileTarget: Coordinate | null;
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
  incomingMissileTarget: null,
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
    incomingMissileTarget: state.incomingMissileTarget ?? null,
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
  useGameStore.getState().removeMissile(missileId);
}

function playBattleEffect(morseEngine: MorseEngine | null, effect: BattleSoundEffect): void {
  morseEngine?.playBattleEffect(effect);
}

function playMissileLaunchAudio(
  morseEngine: MorseEngine | null,
  isGuided: boolean,
): GuidedMissileTimeline | null {
  if (isGuided) {
    return morseEngine?.playGuidedMissileSequence() ?? null;
  } else {
    playBattleEffect(morseEngine, "missileLaunch");
    return null;
  }
}

function playMissileImpactAudio(
  morseEngine: MorseEngine | null,
  result: "hit" | "miss" | "sunk",
  isGuided: boolean,
): number {
  if (isGuided) {
    const effect = result === "sunk" ? "guidedSunk" : result === "hit" ? "guidedHit" : "guidedMiss";
    return morseEngine?.playGuidedMissileImpact(effect) ?? 0;
  }

  playBattleEffect(morseEngine, result);
  return 0;
}

function toRadarPoint(coord: Coordinate): { x: number; y: number } {
  const { colIndex, rowIndex } = parseCoordinate(coord);
  return { x: (colIndex + 0.5) / 10, y: (rowIndex + 0.5) / 10 };
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

    const flightTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const scheduleFlight = (
      missileId: string,
      timeline: GuidedMissileTimeline | null,
      callback: () => void,
    ) => {
      const previous = flightTimers.get(missileId);
      if (previous !== undefined) clearTimeout(previous);
      const delay = timeline?.flightStartsInMs ?? 0;
      const timer = setTimeout(() => {
        flightTimers.delete(missileId);
        callback();
      }, delay);
      flightTimers.set(missileId, timer);
    };
    const cancelFlight = (missileId: string) => {
      const timer = flightTimers.get(missileId);
      if (timer !== undefined) clearTimeout(timer);
      flightTimers.delete(missileId);
    };

    // ── INCOMING_MISSILE ──────────────────────────────────────────────────
    const stopIncoming = transport.on(GameEventType.INCOMING_MISSILE, (event) => {
      // Async mode has no intercept phase; stale incoming frames are ignored defensively.
      const settings = useGameStore.getState().settings;
      if (settings.battleMode === "async") return;
      const isGuided = settings.difficulty !== "expert";
      const launchTimeline = playMissileLaunchAudio(morseEngine, isGuided);
      const windowMs = settings?.interceptWindowMs ?? INTERCEPT_WINDOW_MS;

      const playbackSequence = toPlaybackSequence(event.payload.morseSequence);
      const incomingTarget = decodeBoardMorseSequence(event.payload.morseSequence);
      scheduleFlight(event.payload.missileId, launchTimeline, () => {
        if (incomingTarget !== null) {
          const point = toRadarPoint(incomingTarget);
          void radarWorker.current?.updateMissile(
            event.payload.missileId,
            point.x,
            point.y,
            0,
            launchTimeline?.flightDurationMs,
          );
        } else {
          void radarWorker.current?.triggerEffect(
            "rocket",
            0.5,
            0.5,
            launchTimeline?.flightDurationMs,
          );
        }
      });

      const deadline =
        typeof event.payload.expiresAt === "number"
          ? event.payload.expiresAt
          : Date.now() + windowMs;

      patchGameLoopRuntimeState({
        incomingMissileAttempts: event.payload.attemptsMade ?? 0,
        incomingMissileDeadline: deadline,
        incomingMissileId: event.payload.missileId,
        incomingMissileMaxAttempts: event.payload.maxAttempts,
        incomingMissileSequence: playbackSequence,
        incomingMissileTarget: decodeBoardMorseSequence(event.payload.morseSequence),
        lastInterceptWrong: false,
      });

      if (!isGuided) morseEngine?.playBattleEffect("incomingMissile");
      void morseEngine?.playSequence(playbackSequence);
    });

    // Async mode resolves immediately, so the opponent receives this launch-only
    // event before RESOLVE_HIT. The target remains private until the result arrives.
    const stopFired = transport.on(GameEventType.MISSILE_FIRED, (event) => {
      const isGuided = useGameStore.getState().settings.difficulty !== "expert";
      const launchTimeline = playMissileLaunchAudio(morseEngine, isGuided);
      scheduleFlight(event.payload.missileId, launchTimeline, () => {
        void radarWorker.current?.triggerEffect(
          "rocket",
          0.5,
          0.5,
          launchTimeline?.flightDurationMs,
        );
      });
    });

    // ── RESOLVE_HIT ───────────────────────────────────────────────────────
    const stopResolve = transport.on(GameEventType.RESOLVE_HIT, (event) => {
      const store   = useGameStore.getState();

      const isByThem = event.payload.attackerId !== store.playerId;
      const boardUpdater = isByThem ? store.applyOwnHit : store.applyEnemyShot;
      const isGuided = store.settings.difficulty !== "expert";

      // RESOLVE_HIT is delivered before the authoritative SYNC_STATE. Reserve
      // the reveal window before GameClient applies either event, so neither
      // player sees a hit/miss board state during shooting -> flying.
      if (isGuided) store.beginRevealDelay();

      // Keep the flight timer alive even when RESOLVE_HIT arrives early: the
      // opponent still needs to see the same `flying` animation before the
      // delayed impact is revealed.
      const point = toRadarPoint(event.payload.target);
      const impactVfxKey = `${isByThem ? "own" : "enemy"}:${event.payload.target}`;
      const impactDelayMs = playMissileImpactAudio(
        morseEngine,
        event.payload.result,
        store.settings.difficulty !== "expert",
      );
      const impactStartsAt = Date.now() + impactDelayMs;
      store.scheduleImpactVfx(impactVfxKey, impactStartsAt);

      const finishRadarEffect = () => {
        void radarWorker.current?.removeMissile(event.payload.missileId);
        void radarWorker.current?.triggerEffect(event.payload.result, point.x, point.y);
      };
      const revealResult = () => {
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
          useGameStore.setState({ winnerId: event.payload.winnerId ?? null });
        }

        if (isGuided) store.releaseRevealDelay();
        resetGameLoopRuntimeState();
      };
      const revealAtImpact = () => {
        finishRadarEffect();
        revealResult();
      };
      // A zero delay still uses a task boundary so GameClient can finish
      // deferring the same RESOLVE_HIT before applying the next frame.
      setTimeout(revealAtImpact, Math.max(0, impactDelayMs));
      setTimeout(() => {
        const current = useGameStore.getState().impactVfxStartsAt[impactVfxKey];
        if (current === impactStartsAt) {
          useGameStore.setState((state) => {
            const next = { ...state.impactVfxStartsAt };
            delete next[impactVfxKey];
            return { impactVfxStartsAt: next };
          });
        }
      }, impactDelayMs + 2_500);

    });

    const stopIntercepted = transport.on(GameEventType.MISSILE_INTERCEPTED, (event) => {
      const runtime = readRuntimeState();
      const isByThem = runtime.incomingMissileId === event.payload.missileId;

      cancelFlight(event.payload.missileId);
      void radarWorker.current?.removeMissile(event.payload.missileId);
      const point = toRadarPoint(event.payload.target);
      void radarWorker.current?.triggerEffect("intercept", point.x, point.y);
      removeMissileFromStore(event.payload.missileId);
      playBattleEffect(morseEngine, "intercept");

      if (isByThem) {
        resetGameLoopRuntimeState();
      }
    });

    // ── SYNC_STATE ────────────────────────────────────────────────────────
    const stopSync = transport.on(GameEventType.SYNC_STATE, (event) => {
      if (
        event.payload.activeMissiles.length === 0 &&
        useGameStore.getState().deferredRevealCount === 0
      ) {
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
          playBattleEffect(morseEngine, "wrong");
          patchGameLoopRuntimeState({ lastInterceptWrong: true });
          setTimeout(() => {
            patchGameLoopRuntimeState({ lastInterceptWrong: false });
          }, 700);
        }
      }
    });

    const cleanup = () => {
      stopIncoming();
      stopFired();
      stopResolve();
      stopIntercepted();
      stopSync();
      stopCooldown();
      stopError();
      for (const timer of flightTimers.values()) clearTimeout(timer);
      flightTimers.clear();
      cleanupRef.current = () => {};
    };

    cleanupRef.current = cleanup;
    return cleanup;
  }, [morseEngine, radarWorker, transport]);

  return cleanupRef.current;
}
