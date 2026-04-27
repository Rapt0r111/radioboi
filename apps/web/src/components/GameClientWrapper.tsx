// apps/web/src/components/GameClientWrapper.tsx
"use client";

import {
  type Coordinate,
  coordinateToMorseNotation,
  GameEventType,
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
import { MorseTelegraph } from "@/src/components/MorseTelegraph";
import { RadarCanvas, type RadarRef } from "@/src/components/RadarCanvas";
import { ShipPlacementScreen } from "@/src/components/ShipPlacementScreen";
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

type Props = {
  roomId: string;
};

type RuntimeCarrier = ReturnType<typeof useGameStore.getState> & {
  incomingMissileAttempts?: number;
  incomingMissileDeadline?: number | null;
  incomingMissileId?: string | null;
  incomingMissileSequence?: number[] | null;
  lastInterceptWrong?: boolean;
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
  return `${letter}${digit} / ${coord}`;
}

// ── Lobby overlay (waiting for opponent) ──────────────────────────────────────

function LobbyOverlay({
  roomId,
  morseEngine,
}: {
  roomId: string;
  morseEngine: MorseEngine | null;
}) {
  const [tick, setTick] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => !t), 500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-[var(--color-ocean-950)] crt-scanlines">
      {morseEngine && <AudioUnlocker engine={morseEngine} />}

      <div className="w-full max-w-sm rounded border border-[var(--color-radar-green)]/40 bg-[var(--color-ocean-900)] p-8 radar-glow">
        {/* Terminal bar */}
        <div className="mb-6 flex items-center gap-2 border-b border-[var(--color-radar-green)]/20 pb-3">
          <span className="h-2 w-2 rounded-full bg-[var(--color-hit-red)]" aria-hidden="true" />
          <span className="h-2 w-2 rounded-full bg-[var(--color-morse-amber)]" aria-hidden="true" />
          <span className="h-2 w-2 rounded-full bg-[var(--color-radar-green)]" aria-hidden="true" />
          <span className="ml-2 font-mono text-[9px] uppercase tracking-widest text-[var(--color-miss-white)]/25">
            RADIOBOI · ОЖИДАНИЕ
          </span>
        </div>

        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-miss-white)]/40">
          Код комнаты
        </p>
        <p className="morse-glow mb-6 font-mono text-3xl font-bold tracking-[0.5em] text-[var(--color-radar-green)]">
          {roomId}
        </p>
        <p className="font-mono text-sm text-[var(--color-miss-white)]/60">
          Поделитесь кодом с противником.
        </p>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-[var(--color-radar-green)]">
          ОЖИДАНИЕ ВТОРОГО ИГРОКА
          <span
            className="ml-1"
            style={{ opacity: tick ? 1 : 0 }}
            aria-hidden="true"
          >
            ▌
          </span>
        </p>
      </div>

      <p className="font-mono text-[9px] uppercase tracking-widest text-[var(--color-miss-white)]/15">
        RADIOBOI · CLOUDFLARE EDGE NETWORK
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GameClientWrapper({ roomId }: Props) {
  const enemyBoard = useGameStore(selectEnemyBoard);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const ownBoard = useGameStore(selectOwnBoard);
  const phase = useGameStore(selectPhase);
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
  const radarRef = useRef<RadarRef>(null);

  useGameLoop(transport, radarRef, morseEngine);

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
      setTransport(null);
      destroyGameClient();
      void engine.close();
      setMorseEngine(null);
    };
  }, [roomId, setSession]);

  useEffect(() => {
    if (incomingMissileDeadline === null) {
      setNow(Date.now());
      return;
    }
    const timerId = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timerId);
  }, [incomingMissileDeadline]);

  // Reset selected target when turn or intercept context changes.
  useEffect(() => {
    if (!isMyTurn || incomingMissileId !== null || phase !== "battle") {
      setSelectedTarget(null);
    }
  }, [incomingMissileId, isMyTurn, phase]);

  // Show server-confirmed wrong-decode feedback in the status line.
  useEffect(() => {
    if (lastInterceptWrong) {
      setStatusLine("✕ Неверная расшифровка. Слушайте ещё раз и повторите.");
      // Clear the flag so subsequent correct attempts reset the message.
      patchGameLoopRuntimeState({ lastInterceptWrong: false });
    }
  }, [lastInterceptWrong]);

  const handleSequenceComplete = useEffectEvent((coord: Coordinate) => {
    if (!transport) {
      setStatusLine("Транспорт ещё не поднят. Попробуйте через секунду.");
      return;
    }

    if (incomingMissileId !== null) {
      const attemptNumber = incomingMissileAttempts + 1;
      patchGameLoopRuntimeState({
        incomingMissileAttempts: Math.min(attemptNumber, INTERCEPT_ATTEMPT_LIMIT),
        lastInterceptWrong: false, // optimistic clear; server may set it back
      });
      transport.send({
        payload: { attemptNumber, decodedCoord: coord, missileId: incomingMissileId },
        type: GameEventType.INTERCEPT_ATTEMPT,
      });
      setStatusLine(`Перехват ${attemptNumber}/${INTERCEPT_ATTEMPT_LIMIT}: ${formatCoord(coord)}.`);
      return;
    }

    if (!isMyTurn) {
      setStatusLine("Сейчас не ваш ход.");
      return;
    }
    if (selectedTarget === null) {
      setStatusLine("Сначала отметьте цель на вражеской сетке.");
      return;
    }
    if (coord !== selectedTarget) {
      setStatusLine(`✕ Передача не совпала. Ожидали ${formatCoord(selectedTarget)}. Повторите.`);
      return;
    }

    const missileId = crypto.randomUUID();
    const timestamp = Date.now();
    const morseSequence = toMorseSequence(coord);
    const radarPoint = toRadarPoint(coord);

    useGameStore.getState().addMissile({ id: missileId, launchedAt: timestamp, target: coord });
    void radarRef.current?.updateMissile(missileId, radarPoint.x, radarPoint.y, 0);
    transport.send({ payload: { missileId, target: coord }, type: GameEventType.ATTACK_PREP });
    transport.send({
      payload: { missileId, morseSequence, target: coord, timestamp },
      type: GameEventType.MISSILE_LAUNCHED,
    });
    setSelectedTarget(null);
    setStatusLine(`✓ Передача подтверждена: ${formatCoord(coord)}. Ожидайте результата.`);
  });

  // ── Phase-based rendering ─────────────────────────────────────────────────
  // All hooks above — early returns only after them.

  if (phase === "lobby") {
    return <LobbyOverlay roomId={roomId} morseEngine={morseEngine} />;
  }

  if (phase === "placement") {
    return (
      <>
        {morseEngine && <AudioUnlocker engine={morseEngine} />}
        <ShipPlacementScreen transport={transport} playerId={playerId} roomId={roomId} />
      </>
    );
  }

  if (phase === "gameOver") {
    return (
      <>
        {morseEngine && <AudioUnlocker engine={morseEngine} />}
        <GameOverScreen playerId={playerId} roomId={roomId} />
      </>
    );
  }

  // ── Battle phase ──────────────────────────────────────────────────────────

  const secondsLeft =
    incomingMissileDeadline === null
      ? null
      : Math.max(0, Math.ceil((incomingMissileDeadline - now) / 1000));
  const telegraphMode = incomingMissileId === null ? "attack" : "intercept";
  const turnLabel = isMyTurn ? "Ваш ход" : "Ожидание противника";

  return (
    <div className="relative min-h-dvh bg-[var(--color-ocean-950)] text-[var(--color-miss-white)]">
      {morseEngine ? <AudioUnlocker engine={morseEngine} /> : null}
      <ConnectionMonitor />

      <main className="crt-scanlines mx-auto flex min-h-dvh w-full max-w-360 flex-col gap-6 px-4 py-6 lg:px-8">
        {/* Header */}
        <header className="rounded border border-[var(--color-ocean-800)] bg-[var(--color-ocean-900)]/80 p-4 shadow-[0_0_24px_rgba(0,255,136,0.06)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-[var(--color-radar-green)]/60">
                Морской радиобой
              </p>
              <h1 className="morse-glow font-mono text-2xl font-bold tracking-[0.28em] text-[var(--color-radar-green)]">
                ROOM {roomId}
              </h1>
            </div>
            <div className="grid gap-2 font-mono text-[11px] text-[var(--color-miss-white)]/55 sm:grid-cols-3">
              <div className="rounded border border-[var(--color-ocean-800)] px-3 py-2">
                <span className="block text-[9px] uppercase tracking-[0.22em] text-[var(--color-radar-green)]/50">
                  Фаза
                </span>
                <span>{phase}</span>
              </div>
              <div className="rounded border border-[var(--color-ocean-800)] px-3 py-2">
                <span className="block text-[9px] uppercase tracking-[0.22em] text-[var(--color-radar-green)]/50">
                  Статус
                </span>
                <span>{turnLabel}</span>
              </div>
              <div className="rounded border border-[var(--color-ocean-800)] px-3 py-2">
                <span className="block text-[9px] uppercase tracking-[0.22em] text-[var(--color-radar-green)]/50">
                  Оператор
                </span>
                <span>{playerId ? playerId.slice(0, 8) : "..."}</span>
              </div>
            </div>
          </div>
        </header>

        {/* Game grid */}
        <section
          className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.85fr)_minmax(0,1fr)]"
          aria-label="Главный игровой экран"
        >
          {/* Enemy sector */}
          <section className="rounded border border-[var(--color-ocean-800)] bg-[var(--color-ocean-900)]/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-mono text-sm uppercase tracking-[0.28em] text-[var(--color-radar-green)]">
                  Вражеский сектор
                </h2>
                <p className="font-mono text-[10px] text-[var(--color-miss-white)]/40">
                  Радарный канал совмещён с целевой сеткой.
                </p>
              </div>
              <div className="rounded border border-[var(--color-ocean-800)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-morse-amber)]">
                Цель: {formatCoord(selectedTarget)}
              </div>
            </div>
            <div className="relative inline-block max-w-full">
              <BoardGrid
                board={enemyBoard}
                isEnemy
                onCellClick={(coord) => {
                  if (phase !== "battle") {
                    setStatusLine("Боевая сетка активируется только в фазе battle.");
                    return;
                  }
                  if (incomingMissileId !== null) {
                    setStatusLine("Сначала завершите перехват входящей ракеты.");
                    return;
                  }
                  if (!isMyTurn) {
                    setStatusLine("Сейчас не ваш ход.");
                    return;
                  }
                  setSelectedTarget(coord);
                  setStatusLine(
                    `Цель захвачена: ${formatCoord(coord)}. Передайте её по Морзе.`,
                  );
                }}
              />
              <RadarCanvas radarRef={radarRef} />
            </div>
          </section>

          {/* Radio channel */}
          <section className="flex flex-col gap-4">
            <div className="rounded border border-[var(--color-ocean-800)] bg-[var(--color-ocean-900)]/80 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-[var(--color-radar-green)]/60">
                    Радиоканал
                  </p>
                  <p
                    className={`font-mono text-sm ${
                      statusLine.startsWith("✕")
                        ? "text-[var(--color-hit-red)]"
                        : statusLine.startsWith("✓")
                          ? "text-[var(--color-radar-green)]"
                          : "text-[var(--color-miss-white)]/70"
                    }`}
                  >
                    {statusLine}
                  </p>
                </div>
                <div className="grid gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-miss-white)]/60">
                  <span>Режим: {telegraphMode === "attack" ? "атака" : "перехват"}</span>
                  <span>
                    Таймер:{" "}
                    {secondsLeft === null ? "нет сигнала" : `${secondsLeft.toString()}с`}
                  </span>
                  <span>
                    Попытки:{" "}
                    {incomingMissileId === null
                      ? "—"
                      : `${incomingMissileAttempts}/${INTERCEPT_ATTEMPT_LIMIT}`}
                  </span>
                </div>
              </div>
            </div>

            <MorseTelegraph
              mode={telegraphMode}
              morseEngine={morseEngine}
              onSequenceComplete={handleSequenceComplete}
            />

            {morseEngine ? (
              <GameControls
                currentIncomingSequence={incomingMissileSequence}
                currentMissileId={incomingMissileId}
                engine={morseEngine}
              />
            ) : null}
          </section>

          {/* Own sector */}
          <section className="rounded border border-[var(--color-ocean-800)] bg-[var(--color-ocean-900)]/80 p-4">
            <div className="mb-3">
              <h2 className="font-mono text-sm uppercase tracking-[0.28em] text-[var(--color-radar-green)]">
                Собственный сектор
              </h2>
              <p className="font-mono text-[10px] text-[var(--color-miss-white)]/40">
                Входящий удар обновляет вашу доску через общий игровой цикл.
              </p>
            </div>
            <div className="inline-block max-w-full">
              <BoardGrid board={ownBoard} isEnemy={false} />
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}