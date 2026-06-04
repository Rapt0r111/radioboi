"use client";
// apps/web/src/components/GameClientWrapper.tsx
//
// ASYNC MODE additions:
//   - Reads settings.battleMode from store
//   - canSelectEnemyTarget logic differs: async uses !isOnCooldown instead of isMyTurn
//   - Cooldown countdown shown in header badge
//   - "Reload" indicator replaces "Your turn" in async mode
//   - Async has no intercept phase: both players fire independently after reload

import {
  type Coordinate,
  coordinateToMorseNotation,
  GameEventType,
  makeCoordinate,
  type MorseSymbol,
  parseCoordinate,
  type RoomSettings,
} from "@radioboi/game-core";
import { MORSE_ALPHABET, MorseEngine } from "@radioboi/morse-engine";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AudioUnlocker } from "@/src/components/AudioUnlocker";
import { BoardGrid } from "@/src/components/BoardGrid";
import { ConnectionMonitor } from "@/src/components/ConnectionMonitor";
import { GameControls } from "@/src/components/GameControls";
import { GameOverScreen } from "@/src/components/GameOverScreen";
import { LobbyScreen } from "@/src/components/LobbyScreen";
import { MorseTelegraph } from "@/src/components/MorseTelegraph";
import { RadarCanvas, type RadarRef } from "@/src/components/RadarCanvas";
import { ShipPlacementScreen } from "@/src/components/ShipPlacementScreen";
import { ShotHistory } from "@/src/components/ShotHistory";
import { WaitingScreen } from "@/src/components/WaitingScreen";
import {
  patchGameLoopRuntimeState,
  resetGameLoopRuntimeState,
  useGameLoop,
} from "@/src/hooks/useGameLoop";
import type { GameClient } from "@/src/lib/network/gameClient";
import { destroyGameClient, getGameClient } from "@/src/lib/network/gameClient";
import { useNow } from "@/src/hooks/useNow";
import {
  selectCooldownExpiresAt,
  selectEnemyBoard,
  selectIsMyTurn,
  selectOwnBoard,
  selectPhase,
  selectSettings,
  useGameStore,
} from "@/src/store/gameStore";

const PLAYER_ID_KEY = "radioboi:playerId";
const TAB_ID_KEY = "radioboi:tabId";
const TAB_NAME_PREFIX = "radioboi-tab:";
const PLACED_KEY_PREFIX = "radioboi:placed:";
const ROOM_SETTINGS_KEY_PREFIX = "radioboi:settings:";
const ATTACKER_TURN_TIMEOUT_S = 60;
const ATTEMPT_DOT_KEYS = ["attempt-1", "attempt-2", "attempt-3", "attempt-4", "attempt-5"] as const;

type Props = { roomId: string };

type RuntimeCarrier = ReturnType<typeof useGameStore.getState> & {
  incomingMissileAttempts?: number;
  incomingMissileDeadline?: number | null;
  incomingMissileId?: string | null;
  incomingMissileMaxAttempts?: number;
  incomingMissileSequence?: number[] | null;
  lastInterceptWrong?: boolean;
};

function getOrCreateTabId(): string {
  if (window.name.startsWith(TAB_NAME_PREFIX)) {
    return window.name.slice(TAB_NAME_PREFIX.length);
  }
  const next = crypto.randomUUID();
  window.name = `${TAB_NAME_PREFIX}${next}`;
  return next;
}

function getOrCreatePlayerId(): string {
  const tabId = getOrCreateTabId();
  const storedTabId = sessionStorage.getItem(TAB_ID_KEY);
  const stored = sessionStorage.getItem(PLAYER_ID_KEY);
  if (stored !== null && storedTabId === tabId) return stored;
  const next = crypto.randomUUID();
  sessionStorage.setItem(TAB_ID_KEY, tabId);
  sessionStorage.setItem(PLAYER_ID_KEY, next);
  return next;
}

function readStoredRoomSettings(roomId: string): RoomSettings | undefined {
  try {
    const raw = sessionStorage.getItem(`${ROOM_SETTINGS_KEY_PREFIX}${roomId}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<RoomSettings>;
    return {
      battleMode: parsed.battleMode === "async" ? "async" : "turn-based",
      attackCooldownMs: typeof parsed.attackCooldownMs === "number" ? parsed.attackCooldownMs : 2_000,
      interceptWindowMs: typeof parsed.interceptWindowMs === "number" ? parsed.interceptWindowMs : 25_000,
      maxInterceptAttempts: typeof parsed.maxInterceptAttempts === "number" ? parsed.maxInterceptAttempts : 3,
    };
  } catch {
    return undefined;
  }
}

function toMorseSequence(coord: Coordinate): MorseSymbol[] {
  const { digit, letter } = coordinateToMorseNotation(coord);
  const letterToken = MORSE_ALPHABET[letter];
  const digitToken = MORSE_ALPHABET[digit];
  if (letterToken === undefined || digitToken === undefined) {
    throw new Error(`Cannot encode coordinate ${coord} to Morse`);
  }
  return [...`${letterToken}${digitToken}`].filter(
    (s): s is MorseSymbol => s === "." || s === "-",
  );
}

function toRadarPoint(coord: Coordinate): { x: number; y: number } {
  const { colIndex, rowIndex } = parseCoordinate(coord);
  return { x: (colIndex + 0.5) / 10, y: (rowIndex + 0.5) / 10 };
}

function formatCoord(coord: Coordinate | null): string {
  if (coord === null) return "???";
  const { digit, letter } = coordinateToMorseNotation(coord);
  const columnLabel = digit === "0" ? "10" : digit;
  return `${letter}${columnLabel}`;
}

function formatMorseForCoord(coord: Coordinate | null): string {
  if (coord === null) return "—";
  const { digit, letter } = coordinateToMorseNotation(coord);
  const letterToken = MORSE_ALPHABET[letter] ?? "?";
  const digitToken = MORSE_ALPHABET[digit] ?? "?";
  return `${letter} ${letterToken}  ${digit} ${digitToken}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function GameClientWrapper({ roomId }: Props) {
  const phase = useGameStore(selectPhase);
  const enemyBoard = useGameStore(selectEnemyBoard);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const ownBoard = useGameStore(selectOwnBoard);
  const playerId = useGameStore((s) => s.playerId);
  const setSession = useGameStore((s) => s.setSession);
  const settings = useGameStore(selectSettings);
  const cooldownExpiresAt = useGameStore(selectCooldownExpiresAt);

  const isAsync = settings.battleMode === "async";

  const incomingMissileAttempts = useGameStore(
    (s) => (s as RuntimeCarrier).incomingMissileAttempts ?? 0,
  );
  const incomingMissileDeadline = useGameStore(
    (s) => (s as RuntimeCarrier).incomingMissileDeadline ?? null,
  );
  const incomingMissileId = useGameStore(
    (s) => (s as RuntimeCarrier).incomingMissileId ?? null,
  );
  const incomingMissileMaxAttempts = useGameStore(
    (s) => (s as RuntimeCarrier).incomingMissileMaxAttempts ?? settings.maxInterceptAttempts,
  );
  const incomingMissileSequence = useGameStore(
    (s) => (s as RuntimeCarrier).incomingMissileSequence ?? null,
  );
  const lastInterceptWrong = useGameStore(
    (s) => (s as RuntimeCarrier).lastInterceptWrong ?? false,
  );

  const [morseEngine, setMorseEngine] = useState<MorseEngine | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<Coordinate | null>(null);
  const [statusLine, setStatusLine] = useState(
    isAsync
      ? "Выберите цель и передайте по Морзе. В асинхронном режиме оба игрока атакуют одновременно."
      : "Выберите цель на вражеской сетке и передайте её по Морзе.",
  );
  const [transport, setTransport] = useState<GameClient | null>(null);
  const [unitMs, setUnitMs] = useState(60);
  const [attackerTurnStart, setAttackerTurnStart] = useState<number | null>(null);
  const [hasPlaced, setHasPlaced] = useState(() => {
    try { return sessionStorage.getItem(`${PLACED_KEY_PREFIX}${roomId}`) === "1"; }
    catch { return false; }
  });

  const missileInFlightRef = useRef(false);
  const [missileInFlightUI, setMissileInFlightUI] = useState(false);
  const radarRef = useRef<RadarRef>(null);
  const autoResolveMissileIdRef = useRef<string | null>(null);

  useGameLoop(transport, radarRef, morseEngine);

  // ── Derived: cooldown ───────────────────────────────────────────────────────
  const needsTick =
    incomingMissileDeadline !== null ||       // intercept timer running
    (attackerTurnStart !== null && isMyTurn) || // attacker turn timer
    (isAsync && cooldownExpiresAt !== null);    // cooldown timer
  const now = useNow(needsTick);
  const isOnCooldown = isAsync && cooldownExpiresAt !== null && now < cooldownExpiresAt;
  const cooldownSecondsLeft = isOnCooldown && cooldownExpiresAt !== null
    ? Math.ceil((cooldownExpiresAt - now) / 1000)
    : null;

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase === "battle") {
      try { sessionStorage.removeItem(`${PLACED_KEY_PREFIX}${roomId}`); } catch { /* noop */ }
    }
  }, [phase, roomId]);

  useEffect(() => {
    // Turn-based attacker timer
    if (!isAsync && phase === "battle" && isMyTurn && incomingMissileId === null) {
      setAttackerTurnStart(Date.now());
    } else {
      setAttackerTurnStart(null);
    }
  }, [isAsync, phase, isMyTurn, incomingMissileId]);

  useEffect(() => {
    useGameStore.getState().reset();
    const nextPlayerId = getOrCreatePlayerId();
    const client = getGameClient();
    const engine = new MorseEngine();
    const storedRoomSettings = readStoredRoomSettings(roomId);

    setSession(nextPlayerId, roomId);
    if (storedRoomSettings !== undefined) {
      useGameStore.setState({ settings: storedRoomSettings });
    }
    setTransport(client);
    setMorseEngine(engine);
    client.connect(roomId, nextPlayerId, `Player-${nextPlayerId.slice(0, 4)}`, storedRoomSettings);

    return () => {
      resetGameLoopRuntimeState();
      setSelectedTarget(null);
      missileInFlightRef.current = false;
      setMissileInFlightUI(false);
      setTransport(null);
      destroyGameClient();
      void engine.close();
      setMorseEngine(null);
    };
  }, [roomId, setSession]);

  // Tick timer — runs when any countdown is active


  // Auto-resolve intercept on deadline (turn-based only)
  useEffect(() => {
    if (isAsync || !transport || incomingMissileId === null || incomingMissileDeadline === null) {
      autoResolveMissileIdRef.current = null;
      return;
    }
    if (now < incomingMissileDeadline || autoResolveMissileIdRef.current === incomingMissileId) {
      return;
    }
    autoResolveMissileIdRef.current = incomingMissileId;
    patchGameLoopRuntimeState({ incomingMissileAttempts: incomingMissileMaxAttempts });
    transport.send({
      type: GameEventType.INTERCEPT_ATTEMPT,
      payload: {
        attemptNumber: incomingMissileMaxAttempts,
        decodedCoord: makeCoordinate(9, 9),
        missileId: incomingMissileId,
      },
    });
    setStatusLine("Время перехвата истекло. Ракета ушла на расчет результата.");
  }, [incomingMissileDeadline, incomingMissileId, incomingMissileMaxAttempts, isAsync, now, transport]);

  const activeMissilesCount = useGameStore((s) => s.activeMissiles.length);

  useEffect(() => {
    if (activeMissilesCount === 0) {
      missileInFlightRef.current = false;
      setMissileInFlightUI(false);
    }
  }, [activeMissilesCount]);

  useEffect(() => {
    if (!isAsync && (!isMyTurn || incomingMissileId !== null || phase !== "battle")) {
      missileInFlightRef.current = false;
      setSelectedTarget(null);
    }
  }, [incomingMissileId, isAsync, isMyTurn, phase]);

  // After cooldown expires, clear selected target so player can pick again
  useEffect(() => {
    if (isAsync && !isOnCooldown && phase === "battle") {
      // Don't clear — let the player keep their selection through a cooldown
    }
  }, [isAsync, isOnCooldown, phase]);

  // ── Morse sequence complete callback ─────────────────────────────────────────

  const handleSequenceComplete = useEffectEvent((coord: Coordinate) => {
    if (!transport) { setStatusLine("Транспорт ещё не поднят."); return; }

    // Intercept is available only in turn-based mode.
    if (!isAsync && incomingMissileId !== null) {
      const attemptNumber = incomingMissileAttempts + 1;
      patchGameLoopRuntimeState({
        incomingMissileAttempts: Math.min(attemptNumber, incomingMissileMaxAttempts),
      });
      transport.send({
        type: GameEventType.INTERCEPT_ATTEMPT,
        payload: { attemptNumber, decodedCoord: coord, missileId: incomingMissileId },
      });
      setStatusLine(`Перехват ${attemptNumber}/${incomingMissileMaxAttempts}: ${formatCoord(coord)}.`);
      return;
    }

    // Turn-based checks
    if (!isAsync && !isMyTurn) { setStatusLine("Сейчас не ваш ход."); return; }

    // Async cooldown check
    if (isAsync && isOnCooldown) {
      setStatusLine(`Перезарядка — осталось ${cooldownSecondsLeft ?? "?"}с.`);
      return;
    }

    if (selectedTarget === null) { setStatusLine("Сначала отметьте цель на вражеской сетке."); return; }
    if (coord !== selectedTarget) {
      setStatusLine(`Передача не совпала. Ожидали ${formatCoord(selectedTarget)}.`);
      return;
    }

    if (missileInFlightRef.current) { setStatusLine("Ракета в полёте. Ожидайте результата."); return; }

    const missileId = crypto.randomUUID();
    const timestamp = Date.now();
    const morseSequence = toMorseSequence(coord);
    const radarPoint = toRadarPoint(coord);

    missileInFlightRef.current = true;
    setMissileInFlightUI(true);
    morseEngine?.playBattleEffect("missileLaunch");
    void radarRef.current?.triggerEffect("rocket", radarPoint.x, radarPoint.y);
    if (isAsync) {
      useGameStore.getState().setAttackCooldown(timestamp + settings.attackCooldownMs);
    }

    useGameStore.getState().addMissile({ id: missileId, launchedAt: timestamp, target: coord });
    void radarRef.current?.updateMissile(missileId, radarPoint.x, radarPoint.y, 0);
    transport.send({ type: GameEventType.ATTACK_PREP, payload: { missileId, target: coord } });
    transport.send({ type: GameEventType.MISSILE_LAUNCHED, payload: { missileId, morseSequence, target: coord, timestamp } });
    setSelectedTarget(null);
    setAttackerTurnStart(null);
    setStatusLine(`Передача подтверждена: ${formatCoord(coord)}.`);
  });

  // ── Phase routing ──────────────────────────────────────────────────────────

  if (phase === "gameOver") return <GameOverScreen roomId={roomId} />;

  if (phase === "lobby") {
    return (
      <>
        <ConnectionMonitor />
        <LobbyScreen roomId={roomId} />
      </>
    );
  }

  if (phase === "placement") {
    if (hasPlaced) {
      return (
        <>
          <ConnectionMonitor />
          <WaitingScreen roomId={roomId} />
        </>
      );
    }
    return (
      <>
        <ConnectionMonitor />
        <ShipPlacementScreen
          transport={transport}
          playerId={playerId}
          onPlaced={() => {
            setHasPlaced(true);
            try { sessionStorage.setItem(`${PLACED_KEY_PREFIX}${roomId}`, "1"); } catch { /* noop */ }
          }}
        />
      </>
    );
  }

  // ── Battle phase ──────────────────────────────────────────────────────────

  const interceptSecondsLeft =
    isAsync || incomingMissileDeadline === null
      ? null
      : Math.max(0, Math.ceil((incomingMissileDeadline - now) / 1000));

  const attackerSecondsLeft =
    !isAsync && attackerTurnStart !== null && isMyTurn && incomingMissileId === null
      ? Math.max(0, ATTACKER_TURN_TIMEOUT_S - Math.floor((now - attackerTurnStart) / 1000))
      : null;

  const isAttackerWarning = attackerSecondsLeft !== null && attackerSecondsLeft <= 15;

  const hasTurnBasedIncomingMissile = !isAsync && incomingMissileId !== null;
  const telegraphMode = hasTurnBasedIncomingMissile ? "intercept" : "attack";

  // Async: can attack whenever not on cooldown and no missile in flight
  // Turn-based: only on our turn
  const canSelectEnemyTarget =
    phase === "battle" &&
    !hasTurnBasedIncomingMissile &&
    (isAsync ? !isOnCooldown : isMyTurn) &&
    !missileInFlightUI;

  const turnLabel = isAsync
    ? isOnCooldown
      ? `⏳ ПЕРЕЗАРЯДКА ${cooldownSecondsLeft ?? ""}с`
      : "⚡ ОГОНЬ ОТКРЫТ"
    : isMyTurn
      ? "▸ ВАШ ХОД"
      : "◃ Ожидание противника";

  const turnBadgeClass = isAsync
    ? isOnCooldown
      ? "border-morse-amber/50 text-morse-amber"
      : "border-radar-green/50 text-radar-green"
    : isMyTurn
      ? "border-radar-green/50 text-radar-green"
      : "border-ocean-800 text-miss-white/40";

  const targetLabel = formatCoord(selectedTarget);
  const targetMorseLabel = formatMorseForCoord(selectedTarget);

  const actionTitle =
    hasTurnBasedIncomingMissile
      ? "Перехват входящей ракеты"
      : isAsync
        ? isOnCooldown
          ? "Перезарядка орудия"
          : selectedTarget === null
            ? "Выберите цель для атаки"
            : "Передайте выбранную цель"
        : isMyTurn
          ? selectedTarget === null
            ? "Выберите цель на поле противника"
            : "Передайте выбранную цель"
          : "Ожидайте ход противника";

  const actionDetail =
    hasTurnBasedIncomingMissile
      ? `Примите сигнал и введите координату. Попытка ${Math.min(incomingMissileAttempts + 1, incomingMissileMaxAttempts)}/${incomingMissileMaxAttempts}.`
      : isAsync
        ? isOnCooldown
          ? `Орудие перезаряжается. Осталось ${cooldownSecondsLeft ?? "?"}с. В ASYNC нет перехвата — следите за полем и готовьте следующий выстрел.`
          : selectedTarget === null
            ? "Кликните по клетке противника. Оба игрока атакуют независимо."
            : `Зажмите ключ и передайте: ${targetMorseLabel}.`
        : isMyTurn
          ? selectedTarget === null
            ? "Кликните по свободной клетке. После выбора появится код Морзе."
            : `Зажмите телеграфный ключ и передайте: ${targetMorseLabel}.`
          : "Пока соперник атакует, следите за своим полем.";

  const enemyBoardDisabledMessage =
    hasTurnBasedIncomingMissile
      ? "Сначала завершите перехват входящей ракеты."
      : isAsync
        ? isOnCooldown
          ? `Орудие перезаряжается — ${cooldownSecondsLeft ?? "?"}с.`
          : missileInFlightUI
            ? "Ракета уже в полёте."
            : undefined
        : !isMyTurn
          ? "Сейчас ход противника."
          : missileInFlightUI
            ? "Ракета уже в полёте."
            : undefined;

  return (
    <div className="battle-shell relative min-h-dvh text-miss-white">
      {morseEngine ? <AudioUnlocker engine={morseEngine} /> : null}
      <ConnectionMonitor />

      <main className="crt-scanlines mx-auto flex min-h-dvh w-full max-w-[1600px] flex-col gap-4 px-4 py-4 lg:px-6 lg:py-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="battle-panel rounded border p-3 shadow-[0_0_28px_rgba(0,255,136,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.34em] text-radar-green/60">
                {isAsync ? "АСИНХРОННЫЙ БОЙ" : "Морской радиобой"}
              </p>
              <h1
                className="font-mono text-xl font-bold tracking-[0.28em] text-radar-green"
                style={{ textShadow: "0 0 12px rgba(0,255,136,0.4)" }}
              >
                ROOM {roomId}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">

              {/* Turn / async status */}
              <div className={`battle-status-chip rounded border px-3 py-1.5 transition-colors ${turnBadgeClass}`}>
                {turnLabel}
              </div>

              {/* Intercept timer */}
              {interceptSecondsLeft !== null && (
                <div className={`rounded border px-3 py-1.5 tabular-nums transition-colors ${interceptSecondsLeft <= 5
                  ? "border-hit-red/70 text-hit-red animate-pulse"
                  : "border-morse-amber/50 text-morse-amber"
                  }`}>
                  ⏱ {interceptSecondsLeft}с перехват
                </div>
              )}

              {/* Attacker timer (turn-based only) */}
              {attackerSecondsLeft !== null && (
                <div className={`rounded border px-3 py-1.5 tabular-nums transition-colors ${isAttackerWarning
                  ? "border-morse-amber/70 text-morse-amber"
                  : "border-ocean-800 text-miss-white/30"
                  }`}>
                  ⏱ {attackerSecondsLeft}с ход
                </div>
              )}

              {/* Cooldown progress bar (async) */}
              {isAsync && isOnCooldown && cooldownExpiresAt !== null && (
                <div className="flex items-center gap-1.5 rounded border border-morse-amber/30 px-3 py-1.5">
                  <div className="h-1.5 w-20 rounded-full bg-ocean-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-morse-amber/70 transition-all"
                      style={{
                        width: `${Math.max(0, Math.min(100,
                          ((cooldownExpiresAt - now) / settings.attackCooldownMs) * 100
                        ))}%`,
                      }}
                    />
                  </div>
                  <span className="text-morse-amber/70 tabular-nums">
                    {cooldownSecondsLeft}с
                  </span>
                </div>
              )}

              {/* Missile in flight */}
              {missileInFlightUI && (
                <div
                  className="rounded border border-hit-red/50 px-3 py-1.5 text-hit-red"
                  style={{ animation: "morse-blink 0.6s step-end infinite" }}
                >
                  ⬆ РАКЕТА
                </div>
              )}

              {/* Mode badge */}
              <div className="battle-status-chip rounded border border-ocean-800 px-3 py-1.5 text-miss-white/25">
                {isAsync ? "ASYNC" : phase}
              </div>

              <div className="battle-status-chip rounded border border-ocean-800 px-3 py-1.5 text-miss-white/25">
                {playerId ? playerId.slice(0, 8) : "..."}
              </div>
            </div>
          </div>
        </header>

        {/* ── Game field ──────────────────────────────────────────────────── */}
        <div className="grid flex-1 gap-4 xl:grid-cols-[1fr_320px_1fr]">

          {/* ── Enemy board ─────────────────────────────────────────────── */}
          <section className="battle-panel flex flex-col gap-3 rounded border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-mono text-sm uppercase tracking-normal text-radar-green">
                  Вражеский сектор
                </h2>
                <p className="font-mono text-[10px] leading-relaxed text-miss-white/45">
                  {canSelectEnemyTarget
                    ? "Выберите клетку для атаки."
                    : enemyBoardDisabledMessage ?? "Клик — выбор цели, затем передача по Морзе."}
                </p>
              </div>
              <div className={`min-w-32 rounded border px-2 py-1 text-right font-mono text-[10px] uppercase tracking-normal transition-colors ${selectedTarget !== null
                ? "border-morse-amber/60 text-morse-amber"
                : "border-ocean-800 text-miss-white/25"
                }`}>
                ⊕ {targetLabel}
              </div>
            </div>

            <div className="relative inline-block max-w-full overflow-hidden self-start">
              <BoardGrid
                board={enemyBoard}
                isEnemy
                selectedCoord={selectedTarget}
                isInteractive={canSelectEnemyTarget}
                disabledMessage={enemyBoardDisabledMessage}
                onCellClick={(coord) => {
                  if (phase !== "battle") return;
                  if (hasTurnBasedIncomingMissile) {
                    setStatusLine("Сначала завершите перехват.");
                    return;
                  }
                  if (isAsync && isOnCooldown) {
                    setStatusLine(`Перезарядка — ${cooldownSecondsLeft ?? "?"}с.`);
                    return;
                  }
                  if (!isAsync && !isMyTurn) { setStatusLine("Не ваш ход."); return; }
                  if (missileInFlightRef.current) {
                    setStatusLine("Ракета в полёте.");
                    return;
                  }
                  setSelectedTarget(coord);
                  setStatusLine(`Цель захвачена: ${formatCoord(coord)}. Передайте по Морзе.`);
                }}
              />
              <RadarCanvas radarRef={radarRef} />


            </div>

            <ShotHistory />
          </section>

          {/* ── Centre: radio channel ────────────────────────────────────── */}
          <section className="flex flex-col gap-3">

            {/* Async mode info badge */}
            {isAsync && (
              <div className="battle-status-chip rounded border border-morse-amber/30 bg-morse-amber/10 px-3 py-2 font-mono text-[9px] text-morse-amber/75 uppercase tracking-widest shadow-[0_0_18px_rgba(255,170,0,0.08)]">
                ⚡ Асинхронный бой · оба игрока атакуют независимо
              </div>
            )}

            {/* Action card */}
            <div className="battle-action-card rounded border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-normal text-radar-green/60">
                    Текущее действие
                  </p>
                  <h2 className="mt-1 font-mono text-sm font-bold text-radar-green">
                    {actionTitle}
                  </h2>
                </div>
                {(interceptSecondsLeft !== null || attackerSecondsLeft !== null || cooldownSecondsLeft !== null) && (
                  <div className={`rounded border px-2 py-1 font-mono text-sm tabular-nums ${interceptSecondsLeft !== null && interceptSecondsLeft <= 5
                    ? "border-hit-red/70 text-hit-red"
                    : cooldownSecondsLeft !== null
                      ? "border-morse-amber/60 text-morse-amber"
                      : "border-morse-amber/60 text-morse-amber"
                    }`}>
                    {interceptSecondsLeft ?? cooldownSecondsLeft ?? attackerSecondsLeft}с
                  </div>
                )}
              </div>
              <p className="mt-2 font-mono text-xs leading-relaxed text-miss-white/70">
                {actionDetail}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded border border-ocean-800/70 bg-ocean-950/50 px-3 py-2">
                  <p className="font-mono text-[9px] uppercase tracking-normal text-miss-white/35">Цель</p>
                  <p className="mt-1 font-mono text-lg text-morse-amber">{targetLabel}</p>
                </div>
                <div className="rounded border border-ocean-800/70 bg-ocean-950/50 px-3 py-2">
                  <p className="font-mono text-[9px] uppercase tracking-normal text-miss-white/35">Морзе</p>
                  <p className="mt-1 break-words font-mono text-lg text-radar-green">{targetMorseLabel}</p>
                </div>
              </div>
            </div>

            {/* Status line */}
            <div className="battle-panel rounded border p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-radar-green/50 mb-1">
                Статус канала
              </p>
              <p className="font-mono text-xs leading-relaxed text-miss-white/70">{statusLine}</p>

              {hasTurnBasedIncomingMissile && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-miss-white/30">
                    Попытки:
                  </span>
                  <div className="flex gap-1">
                    {ATTEMPT_DOT_KEYS.slice(0, incomingMissileMaxAttempts).map((attemptKey, i) => (
                      <div
                        key={attemptKey}
                        className={`h-2 w-2 rounded-full transition-colors ${i < incomingMissileAttempts ? "bg-hit-red" : "bg-ocean-800"
                          }`}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[9px] tabular-nums text-miss-white/30">
                    {incomingMissileAttempts}/{incomingMissileMaxAttempts}
                  </span>
                </div>
              )}
            </div>

            <MorseTelegraph
              mode={telegraphMode}
              morseEngine={morseEngine}
              onSequenceComplete={handleSequenceComplete}
              unitMs={unitMs}
              showWrongFeedback={lastInterceptWrong}
            />

            {morseEngine ? (
              <GameControls
                currentIncomingSequence={hasTurnBasedIncomingMissile ? incomingMissileSequence : null}
                currentMissileId={hasTurnBasedIncomingMissile ? incomingMissileId : null}
                engine={morseEngine}
                onSpeedChange={setUnitMs}
              />
            ) : null}

            {/* Room settings summary */}
            <div className="battle-status-chip rounded border border-ocean-800/50 bg-ocean-900/45 px-3 py-2 font-mono text-[8px] text-miss-white/25 leading-relaxed">
              <span className="text-miss-white/30 uppercase tracking-widest">Настройки: </span>
              {isAsync ? "ASYNC" : "ПОШАГОВЫЙ"}
              {isAsync && ` · перезарядка ${settings.attackCooldownMs / 1000}с`}
              {isAsync
                ? " · перехват отключён"
                : ` · перехват ${settings.interceptWindowMs / 1000}с · ${settings.maxInterceptAttempts} поп.`}
            </div>
          </section>

          {/* ── Own board ───────────────────────────────────────────────── */}
          <section className="battle-panel flex flex-col gap-3 rounded border p-4">
            <div>
              <h2 className="font-mono text-sm uppercase tracking-[0.28em] text-radar-green">
                Собственный сектор
              </h2>
              <p className="font-mono text-[9px] text-miss-white/30">
                Входящие удары отображаются автоматически
              </p>
            </div>
            <div className="inline-block max-w-full overflow-auto">
              <BoardGrid board={ownBoard} isEnemy={false} />
            </div>

            <div className="mt-auto grid grid-cols-2 gap-1.5 rounded border border-ocean-800/50 bg-ocean-950/35 p-2">
              {[
                { symbol: "▪", label: "Корабль", color: "text-radar-green/70" },
                { symbol: "✕", label: "Ранен", color: "text-morse-amber" },
                { symbol: "✕", label: "Потоплен", color: "text-hit-red" },
                { symbol: "·", label: "Промах", color: "text-miss-white/30" },
              ].map(({ symbol, label, color }) => (
                <div key={label} className="flex items-center gap-1.5 font-mono text-[9px]">
                  <span className={`w-3 text-center ${color}`}>{symbol}</span>
                  <span className="text-miss-white/30 uppercase tracking-wider">{label}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
