// apps/web/src/components/GameOverScreen.tsx
"use client";

import { selectWinnerId, useGameStore } from "@/src/store/gameStore";

type Props = {
  roomId: string;
};

export function GameOverScreen({ roomId }: Props) {
  const playerId = useGameStore((s) => s.playerId);
  const winnerId = useGameStore(selectWinnerId);

  const isWinner = winnerId !== null && winnerId === playerId;
  const isDraw = winnerId === null;

  const headline = isDraw ? "НИЧЬЯ" : isWinner ? "ПОБЕДА" : "ПОРАЖЕНИЕ";
  const color = isDraw
    ? "var(--color-morse-amber)"
    : isWinner
      ? "var(--color-radar-green)"
      : "var(--color-hit-red)";
  const symbol = isDraw ? "≈" : isWinner ? "▲" : "✕";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-10 px-4 bg-ocean-950">
      <div
        className="w-full max-w-md rounded border bg-ocean-900/90 p-10 text-center"
        style={{ borderColor: color, boxShadow: `0 0 40px ${color}22` }}
      >
        <div
          className="mb-6 text-6xl font-mono font-bold"
          style={{ color, textShadow: `0 0 20px ${color}` }}
          aria-hidden="true"
        >
          {symbol}
        </div>

        <h1
          className="mb-2 font-mono text-4xl font-bold tracking-[0.3em] uppercase"
          style={{ color, textShadow: `0 0 16px ${color}55` }}
        >
          {headline}
        </h1>

        <p className="font-mono text-xs uppercase tracking-[0.3em] text-miss-white/40">
          {isDraw
            ? "Игра завершена без победителя"
            : isWinner
              ? "Вражеский флот уничтожен"
              : "Ваш флот потоплен"}
        </p>

        <div className="my-8 h-px bg-ocean-800" />
        <p className="font-mono text-[10px] uppercase tracking-widest text-miss-white/30">
          Комната: {roomId}
        </p>
      </div>

      <a
        href="/"
        className="
          rounded border border-radar-green/50
          px-8 py-3 font-mono text-sm font-bold uppercase tracking-widest
          text-radar-green transition-colors duration-150
          hover:bg-radar-green hover:text-ocean-950
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-green
        "
        style={{ boxShadow: "0 0 16px rgba(0,255,136,0.12)" }}
      >
        [ НОВАЯ ИГРА ]
      </a>
    </div>
  );
}
