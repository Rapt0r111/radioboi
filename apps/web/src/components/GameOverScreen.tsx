// apps/web/src/components/GameOverScreen.tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BoardGrid } from "@/src/components/BoardGrid";
import { selectEnemyBoard, selectOwnBoard, selectWinnerId, useGameStore } from "@/src/store/gameStore";

type Props = {
  playerId: string | null;
  roomId: string;
};

export function GameOverScreen({ playerId, roomId }: Props) {
  const router = useRouter();
  const ownBoard = useGameStore(selectOwnBoard);
  const enemyBoard = useGameStore(selectEnemyBoard);
  const winnerId = useGameStore(selectWinnerId);
  const reset = useGameStore((s) => s.reset);

  const isWinner = winnerId !== null && winnerId === playerId;
  const isDraw = winnerId === null;

  // Мигающий курсор для CRT-эффекта
  const [tick, setTick] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => !t), 600);
    return () => clearInterval(id);
  }, []);

  function handlePlayAgain(): void {
    reset();
    router.push("/");
  }

  // ── Данные победителя ────────────────────────────────────────────────────
  const headline = isDraw ? "НИЧЬЯ" : isWinner ? "ПОБЕДА" : "ПОРАЖЕНИЕ";
  const headlineColor = isDraw
    ? "text-[var(--color-morse-amber)]"
    : isWinner
      ? "text-[var(--color-radar-green)]"
      : "text-[var(--color-hit-red)]";
  const glowClass = isDraw ? "" : isWinner ? "morse-glow" : "";

  const ownHits = Object.values(ownBoard).filter((s) => s === "hit" || s === "sunk").length;
  const enemyHits = Object.values(enemyBoard).filter((s) => s === "hit" || s === "sunk").length;

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--color-ocean-950)] text-[var(--color-miss-white)] crt-scanlines">
      {/* Header */}
      <header className="border-b border-[var(--color-ocean-800)] bg-[var(--color-ocean-900)]/80 px-6 py-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.34em] text-[var(--color-radar-green)]/50">
              Морской радиобой · {roomId}
            </p>
            <h1
              className={`font-mono text-4xl font-bold tracking-[0.3em] ${headlineColor} ${glowClass}`}
            >
              {headline}
              <span
                className="ml-1 text-[var(--color-radar-green)]"
                aria-hidden="true"
                style={{ opacity: tick ? 1 : 0 }}
              >
                ▌
              </span>
            </h1>
          </div>

          <button
            type="button"
            onClick={handlePlayAgain}
            className="radar-glow rounded border border-[var(--color-radar-green)] px-6 py-3 font-mono text-sm font-bold uppercase tracking-widest text-[var(--color-radar-green)] transition-colors hover:bg-[var(--color-radar-green)] hover:text-[var(--color-ocean-950)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-radar-green)]"
          >
            [ В ЛОББИ ]
          </button>
        </div>
      </header>

      {/* Stats */}
      <section className="border-b border-[var(--color-ocean-800)] bg-[var(--color-ocean-900)]/40 px-6 py-4">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            {
              label: "Ваши попадания",
              value: enemyHits,
              color: "text-[var(--color-radar-green)]",
            },
            {
              label: "Получено ударов",
              value: ownHits,
              color: "text-[var(--color-hit-red)]",
            },
            {
              label: "Комната",
              value: roomId,
              color: "text-[var(--color-miss-white)]/60",
            },
            {
              label: "Итог",
              value: headline,
              color: headlineColor,
            },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="rounded border border-[var(--color-ocean-800)] px-4 py-3"
            >
              <p className="font-mono text-[8px] uppercase tracking-widest text-[var(--color-miss-white)]/30">
                {label}
              </p>
              <p className={`font-mono text-lg font-bold tabular-nums ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final boards */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-wrap items-start justify-center gap-10 px-6 py-8">
        {/* Own board */}
        <section className="rounded border border-[var(--color-ocean-800)] bg-[var(--color-ocean-900)]/60 p-5">
          <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[var(--color-miss-white)]/50">
            Ваше поле
          </h2>
          <BoardGrid board={ownBoard} isEnemy={false} />
        </section>

        {/* Enemy board */}
        <section className="rounded border border-[var(--color-ocean-800)] bg-[var(--color-ocean-900)]/60 p-5">
          <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[var(--color-miss-white)]/50">
            Поле противника
          </h2>
          <BoardGrid board={enemyBoard} isEnemy />
        </section>
      </main>

      {/* Footer CRT line */}
      <footer className="py-3 text-center font-mono text-[9px] uppercase tracking-widest text-[var(--color-miss-white)]/15">
        RADIOBOI · {isWinner ? "ОПЕРАЦИЯ ЗАВЕРШЕНА УСПЕШНО" : isDraw ? "НИЧЬЯ" : "ОПЕРАЦИЯ ПРОВАЛЕНА"}
      </footer>
    </div>
  );
}