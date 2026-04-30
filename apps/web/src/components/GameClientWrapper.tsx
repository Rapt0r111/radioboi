"use client";

// apps/web/src/components/GameClientWrapper.tsx
//
// FIX: missileInFlight переведён с React state на useRef.
// Причина: setMissileInFlight(true) в useEffectEvent не обновляет state
// синхронно — повторный вызов handleSequenceComplete до следующего рендера
// видит stale false и шлёт второй ATTACK_PREP, вызывая ATTACK_ALREADY_PENDING
// на сервере, а следующий MISSILE_LAUNCHED получает NO_PENDING_ATTACK.

import {
  type Coordinate,
  coordinateToMorseNotation,
  GameEventType,
  makeCoordinate,
  type MorseSymbol,
  parseCoordinate,
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
import {
  selectEnemyBoard,
  selectIsMyTurn,
  selectOwnBoard,
  selectPhase,
  useGameStore,
} from "@/src/store/gameStore";

const PLAYER_ID_KEY = "radioboi:playerId";
const INTERCEPT_ATTEMPT_LIMIT = 3;
const PLACED_KEY_PREFIX = "radioboi:placed:";
const ATTACKER_TURN_TIMEOUT_S = 60;

type Props = {
  roomId: string;
};

type RuntimeCarrier = ReturnType<typeof useGameStore.getState> & {
  incomingMissileAttempts?: number;
  incomingMissileDeadline?: number | null;
  incomingMissileId?: string | null;
  incomingMissileSequence?: number[] | null;
  lastInterceptWrong?: boolean;
  winnerId?: string;
};

function getOrCreatePlayerId(): string {
  const storedPlayerId = sessionStorage.getItem(PLAYER_ID_KEY);
  if (storedPlayerId !== null) return storedPlayerId;
  const nextPlayerId = crypto.randomUUID();
  sessionStorage.setItem(PLAYER_ID_KEY, nextPlayerId);
  return nextPlayerId;
}

function toMorseSequence(coord: Coordinate): MorseSymbol[] {
  const { digit, letter } = coordinateToMorseNotation(coord);
  const letterToken = MORSE_ALPHABET[letter];
  const digitToken = MORSE_ALPHABET[digit];
  if (letterToken === undefined || digitToken === undefined) {
    throw new Error(`Cannot encode coordinate ${coord} to Morse`);
  }
  return [...`${letterToken}${digitToken}`].filter(
    (symbol): symbol is MorseSymbol => symbol === "." || symbol === "-",
  );
}

function toRadarPoint(coord: Coordinate): { x: number; y: number } {
  const { colIndex, rowIndex } = parseCoordinate(coord);
  return { x: (colIndex + 0.5) / 10, y: (rowIndex + 0.5) / 10 };
}

function formatCoord(coord: Coordinate | null): string {
  if (coord === null) return "нет";
  const { digit, letter } = coordinateToMorseNotation(coord);
  return `${letter}${digit} / ${coord.slice(0, 3)}-${Number(coord.slice(3))}`;
}

function formatMorseForCoord(coord: Coordinate | null): string {
  if (coord === null) return "—";
  const { digit, letter } = coordinateToMorseNotation(coord);
  const letterToken = MORSE_ALPHABET[letter] ?? "?";
  const digitToken = MORSE_ALPHABET[digit] ?? "?";
  return `${letter} ${letterToken} · ${digit} ${digitToken}`;
}

// ── Компонент ──────────────────────────────────────────────────────────────────

export function GameClientWrapper({ roomId }: Props) {
  const phase = useGameStore(selectPhase);
  const enemyBoard = useGameStore(selectEnemyBoard);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const ownBoard = useGameStore(selectOwnBoard);
  const playerId = useGameStore((state) => state.playerId);
  const setSession = useGameStore((state) => state.setSession);

  const incomingMissileAttempts = useGameStore(
    (state) => (state as RuntimeCarrier).incomingMissileAttempts ?? 0,
  );
  const incomingMissileDeadline = useGameStore(
    (state) => (state as RuntimeCarrier).incomingMissileDeadline ?? null,
  );
  const incomingMissileId = useGameStore(
    (state) => (state as RuntimeCarrier).incomingMissileId ?? null,
  );
  const incomingMissileSequence = useGameStore(
    (state) => (state as RuntimeCarrier).incomingMissileSequence ?? null,
  );
  const lastInterceptWrong = useGameStore(
    (state) => (state as RuntimeCarrier).lastInterceptWrong ?? false,
  );

  const [morseEngine, setMorseEngine] = useState<MorseEngine | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [selectedTarget, setSelectedTarget] = useState<Coordinate | null>(null);
  const [statusLine, setStatusLine] = useState(
    "Выберите цель на вражеской сетке и передайте её по Морзе.",
  );
  const [transport, setTransport] = useState<GameClient | null>(null);
  const [unitMs, setUnitMs] = useState(60);
  const [attackerTurnStart, setAttackerTurnStart] = useState<number | null>(null);

  // FIX: useRef вместо useState для missileInFlight.
  // useState обновляется асинхронно (батчинг рендеров), поэтому повторный
  // вызов handleSequenceComplete до следующего рендера видит stale false
  // и шлёт дублирующий ATTACK_PREP → ATTACK_ALREADY_PENDING на сервере.
  // useRef обновляется синхронно — гонка устранена.
  const missileInFlightRef = useRef(false);
  // Оставляем derived state для UI (индикатор в заголовке), но как зеркало рефа
  const [missileInFlightUI, setMissileInFlightUI] = useState(false);

  const [hasPlaced, setHasPlaced] = useState(() => {
    try { return sessionStorage.getItem(`${PLACED_KEY_PREFIX}${roomId}`) === "1"; } catch { return false; }
  });

  const radarRef = useRef<RadarRef>(null);
  const autoResolveMissileIdRef = useRef<string | null>(null);
  useGameLoop(transport, radarRef, morseEngine);

  useEffect(() => {
    if (phase === "battle") {
      try { sessionStorage.removeItem(`${PLACED_KEY_PREFIX}${roomId}`); } catch { /* ignore */ }
    }
  }, [phase, roomId]);

  useEffect(() => {
    if (phase === "battle" && isMyTurn && incomingMissileId === null) {
      setAttackerTurnStart(Date.now());
    } else {
      setAttackerTurnStart(null);
    }
  }, [phase, isMyTurn, incomingMissileId]);

  useEffect(() => {
    const nextPlayerId = getOrCreatePlayerId();
    const client = getGameClient();
    const engine = new MorseEngine();

    setSession(nextPlayerId, roomId);
    setTransport(client);
    setMorseEngine(engine);
    client.connect(roomId, nextPlayerId, `Player-${nextPlayerId.slice(0, 4)}`);

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

  useEffect(() => {
    const needsTick =
      incomingMissileDeadline !== null ||
      (attackerTurnStart !== null && isMyTurn);
    if (!needsTick) { setNow(Date.now()); return; }
    const timerId = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timerId);
  }, [incomingMissileDeadline, attackerTurnStart, isMyTurn]);

  useEffect(() => {
    if (
      !transport ||
      incomingMissileId === null ||
      incomingMissileDeadline === null
    ) {
      autoResolveMissileIdRef.current = null;
      return;
    }
    if (
      now < incomingMissileDeadline ||
      autoResolveMissileIdRef.current === incomingMissileId
    ) {
      return;
    }
    autoResolveMissileIdRef.current = incomingMissileId;
    patchGameLoopRuntimeState({ incomingMissileAttempts: INTERCEPT_ATTEMPT_LIMIT });
    transport.send({
      payload: {
        attemptNumber: INTERCEPT_ATTEMPT_LIMIT,
        decodedCoord: makeCoordinate(9, 9),
        missileId: incomingMissileId,
      },
      type: GameEventType.INTERCEPT_ATTEMPT,
    });
    setStatusLine("Время перехвата истекло. Ракета ушла на расчет результата.");
  }, [incomingMissileDeadline, incomingMissileId, now, transport]);

  const activeMissilesCount = useGameStore((s) => s.activeMissiles.length);

  // Синхронно сбрасываем реф когда ракеты больше нет
  useEffect(() => {
    if (activeMissilesCount === 0) {
      missileInFlightRef.current = false;
      setMissileInFlightUI(false);
    }
  }, [activeMissilesCount]);

  useEffect(() => {
    if (!isMyTurn || incomingMissileId !== null || phase !== "battle") {
      // Сброс при смене хода — реф тоже очищаем
      missileInFlightRef.current = false;
      setSelectedTarget(null);
    }
  }, [incomingMissileId, isMyTurn, phase]);

  const handleSequenceComplete = useEffectEvent((coord: Coordinate) => {
    if (!transport) { setStatusLine("Транспорт ещё не поднят."); return; }

    if (incomingMissileId !== null) {
      const attemptNumber = incomingMissileAttempts + 1;
      patchGameLoopRuntimeState({
        incomingMissileAttempts: Math.min(attemptNumber, INTERCEPT_ATTEMPT_LIMIT),
      });
      transport.send({
        payload: { attemptNumber, decodedCoord: coord, missileId: incomingMissileId },
        type: GameEventType.INTERCEPT_ATTEMPT,
      });
      setStatusLine(`Перехват ${attemptNumber}/${INTERCEPT_ATTEMPT_LIMIT}: ${formatCoord(coord)}.`);
      return;
    }

    if (!isMyTurn) { setStatusLine("Сейчас не ваш ход."); return; }
    if (selectedTarget === null) { setStatusLine("Сначала отметьте цель на вражеской сетке."); return; }
    if (coord !== selectedTarget) {
      setStatusLine(`Передача не совпала. Ожидали ${formatCoord(selectedTarget)}.`);
      return;
    }

    // FIX: проверяем реф синхронно — стale state здесь не проблема
    if (missileInFlightRef.current) {
      setStatusLine("Ракета в полёте. Ожидайте результата.");
      return;
    }

    const missileId = crypto.randomUUID();
    const timestamp = Date.now();
    const morseSequence = toMorseSequence(coord);
    const radarPoint = toRadarPoint(coord);

    // Атомарно выставляем реф ДО отправки — любой повторный вызов в той же
    // очереди микрозадач увидит true и не пошлёт второй ATTACK_PREP
    missileInFlightRef.current = true;
    setMissileInFlightUI(true);

    useGameStore.getState().addMissile({ id: missileId, launchedAt: timestamp, target: coord });
    void radarRef.current?.updateMissile(missileId, radarPoint.x, radarPoint.y, 0);
    transport.send({ payload: { missileId, target: coord }, type: GameEventType.ATTACK_PREP });
    transport.send({
      payload: { missileId, morseSequence, target: coord, timestamp },
      type: GameEventType.MISSILE_LAUNCHED,
    });
    setSelectedTarget(null);
    setAttackerTurnStart(null);
    setStatusLine(`Передача подтверждена: ${formatCoord(coord)}.`);
  });

  // ── Маршрутизация фаз ──────────────────────────────────────────────────────

  if (phase === "gameOver") {
    return <GameOverScreen roomId={roomId} />;
  }

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
            try { sessionStorage.setItem(`${PLACED_KEY_PREFIX}${roomId}`, "1"); } catch { /* ignore */ }
          }}
        />
      </>
    );
  }

  // ── Боевая фаза (battle) ──────────────────────────────────────────────────

  const interceptSecondsLeft =
    incomingMissileDeadline === null
      ? null
      : Math.max(0, Math.ceil((incomingMissileDeadline - now) / 1000));

  const attackerSecondsLeft =
    attackerTurnStart !== null && isMyTurn && incomingMissileId === null
      ? Math.max(0, ATTACKER_TURN_TIMEOUT_S - Math.floor((now - attackerTurnStart) / 1000))
      : null;

  const isAttackerWarning = attackerSecondsLeft !== null && attackerSecondsLeft <= 15;
  const telegraphMode = incomingMissileId === null ? "attack" : "intercept";
  const turnLabel = isMyTurn ? "▸ ВАШ ХОД" : "◃ Ожидание противника";
  const canSelectEnemyTarget =
    phase === "battle" &&
    incomingMissileId === null &&
    isMyTurn &&
    !missileInFlightUI;
  const targetLabel = formatCoord(selectedTarget);
  const targetMorseLabel = formatMorseForCoord(selectedTarget);
  const actionTitle =
    incomingMissileId !== null
      ? "Перехват входящей ракеты"
      : isMyTurn
        ? selectedTarget === null
          ? "Выберите цель на поле противника"
          : "Передайте выбранную цель"
        : "Ожидайте ход противника";
  const actionDetail =
    incomingMissileId !== null
      ? `Введите координату принятого сигнала. Попытка ${Math.min(incomingMissileAttempts + 1, INTERCEPT_ATTEMPT_LIMIT)}/${INTERCEPT_ATTEMPT_LIMIT}.`
      : isMyTurn
        ? selectedTarget === null
          ? "Кликните по свободной клетке слева. После выбора появится код Морзе."
          : `Зажмите телеграфный ключ и передайте: ${targetMorseLabel}.`
        : "Пока соперник атакует, ваше поле справа остаётся главным ориентиром.";
  const enemyBoardDisabledMessage =
    incomingMissileId !== null
      ? "Сначала завершите перехват входящей ракеты."
      : !isMyTurn
        ? "Сейчас ход противника."
        : missileInFlightUI
          ? "Ракета уже в полёте."
          : undefined;

  return (
    <div className="relative min-h-dvh bg-ocean-950 text-miss-white">
      {morseEngine ? <AudioUnlocker engine={morseEngine} /> : null}
      <ConnectionMonitor />

      <main className="crt-scanlines mx-auto flex min-h-dvh w-full max-w-[1600px] flex-col gap-4 px-4 py-4 lg:px-6 lg:py-6">

        {/* ── Шапка ──────────────────────────────────────────────────────── */}
        <header className="rounded border border-ocean-800 bg-ocean-900/80 p-3 shadow-[0_0_24px_rgba(0,255,136,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.34em] text-radar-green/60">
                Морской радиобой
              </p>
              <h1 className="font-mono text-xl font-bold tracking-[0.28em] text-radar-green"
                style={{ textShadow: "0 0 12px rgba(0,255,136,0.4)" }}>
                ROOM {roomId}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
              <div className={`rounded border px-3 py-1.5 ${isMyTurn
                ? "border-radar-green/50 text-radar-green"
                : "border-ocean-800 text-miss-white/40"
                }`}>
                {turnLabel}
              </div>

              {interceptSecondsLeft !== null && (
                <div className={`rounded border px-3 py-1.5 tabular-nums transition-colors ${interceptSecondsLeft <= 5
                  ? "border-hit-red/70 text-hit-red animate-pulse"
                  : "border-morse-amber/50 text-morse-amber"
                  }`}>
                  ⏱ {interceptSecondsLeft}с перехват
                </div>
              )}

              {attackerSecondsLeft !== null && (
                <div className={`rounded border px-3 py-1.5 tabular-nums transition-colors ${isAttackerWarning
                  ? "border-morse-amber/70 text-morse-amber"
                  : "border-ocean-800 text-miss-white/30"
                  }`}>
                  ⏱ {attackerSecondsLeft}с ход
                </div>
              )}

              {/* Индикатор ракеты в полёте */}
              {missileInFlightUI && (
                <div className="rounded border border-hit-red/50 px-3 py-1.5 text-hit-red"
                  style={{ animation: "morse-blink 0.6s step-end infinite" }}>
                  ⬆ РАКЕТА
                </div>
              )}

              <div className="rounded border border-ocean-800 px-3 py-1.5 text-miss-white/30">
                {phase}
              </div>

              <div className="rounded border border-ocean-800 px-3 py-1.5 text-miss-white/30">
                {playerId ? playerId.slice(0, 8) : "..."}
              </div>
            </div>
          </div>
        </header>

        {/* ── Игровое поле ────────────────────────────────────────────────── */}
        <div className="grid flex-1 gap-4 xl:grid-cols-[1fr_320px_1fr]">

          {/* ── Левая колонка: вражеское поле ─────────────────────────── */}
          <section className="flex flex-col gap-3 rounded border border-ocean-800 bg-ocean-900/80 p-4">
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

            <div className="relative inline-block max-w-full overflow-auto">
              <BoardGrid
                board={enemyBoard}
                isEnemy
                selectedCoord={selectedTarget}
                isInteractive={canSelectEnemyTarget}
                disabledMessage={enemyBoardDisabledMessage}
                onCellClick={(coord) => {
                  if (phase !== "battle") { setStatusLine("Боевая сетка активируется только в фазе battle."); return; }
                  if (incomingMissileId !== null) { setStatusLine("Сначала завершите перехват входящей ракеты."); return; }
                  if (!isMyTurn) { setStatusLine("Сейчас не ваш ход."); return; }
                  if (missileInFlightRef.current) { setStatusLine("Ракета в полёте. Ожидайте результата."); return; }
                  setSelectedTarget(coord);
                  setStatusLine(`Цель захвачена: ${formatCoord(coord)}. Передайте её по Морзе.`);
                }}
              />
              <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
                <RadarCanvas radarRef={radarRef} />
              </div>
            </div>

            <ShotHistory />
          </section>

          {/* ── Центральная колонка: радиоканал ────────────────────────── */}
          <section className="flex flex-col gap-3">

            <div className="rounded border border-radar-green/35 bg-radar-green/5 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-normal text-radar-green/60">
                    Текущее действие
                  </p>
                  <h2 className="mt-1 font-mono text-sm font-bold text-radar-green">
                    {actionTitle}
                  </h2>
                </div>
                {(interceptSecondsLeft !== null || attackerSecondsLeft !== null) && (
                  <div
                    className={`rounded border px-2 py-1 font-mono text-sm tabular-nums ${
                      interceptSecondsLeft !== null && interceptSecondsLeft <= 5
                        ? "border-hit-red/70 text-hit-red"
                        : "border-morse-amber/60 text-morse-amber"
                    }`}
                  >
                    {interceptSecondsLeft ?? attackerSecondsLeft}с
                  </div>
                )}
              </div>
              <p className="mt-2 font-mono text-xs leading-relaxed text-miss-white/70">
                {actionDetail}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded border border-ocean-800/70 bg-ocean-950/50 px-3 py-2">
                  <p className="font-mono text-[9px] uppercase tracking-normal text-miss-white/35">
                    Цель
                  </p>
                  <p className="mt-1 font-mono text-lg text-morse-amber">
                    {targetLabel}
                  </p>
                </div>
                <div className="rounded border border-ocean-800/70 bg-ocean-950/50 px-3 py-2">
                  <p className="font-mono text-[9px] uppercase tracking-normal text-miss-white/35">
                    Морзе
                  </p>
                  <p className="mt-1 break-words font-mono text-lg text-radar-green">
                    {targetMorseLabel}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded border border-ocean-800 bg-ocean-900/80 p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-radar-green/50 mb-1">
                Статус канала
              </p>
              <p className="font-mono text-xs leading-relaxed text-miss-white/70">
                {statusLine}
              </p>

              {incomingMissileId !== null && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-miss-white/30">
                    Попытки:
                  </span>
                  <div className="flex gap-1">
                    {Array.from({ length: INTERCEPT_ATTEMPT_LIMIT }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-2 w-2 rounded-full transition-colors ${i < incomingMissileAttempts
                          ? "bg-hit-red"
                          : "bg-ocean-800"
                          }`}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[9px] tabular-nums text-miss-white/30">
                    {incomingMissileAttempts}/{INTERCEPT_ATTEMPT_LIMIT}
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
                currentIncomingSequence={incomingMissileSequence}
                currentMissileId={incomingMissileId}
                engine={morseEngine}
                onSpeedChange={setUnitMs}
              />
            ) : null}
          </section>

          {/* ── Правая колонка: своё поле ───────────────────────────────── */}
          <section className="flex flex-col gap-3 rounded border border-ocean-800 bg-ocean-900/80 p-4">
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

            <div className="mt-auto grid grid-cols-2 gap-1.5 rounded border border-ocean-800/50 p-2">
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
