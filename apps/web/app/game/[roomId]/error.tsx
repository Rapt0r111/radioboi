// apps/web/app/game/[roomId]/error.tsx
"use client";

// Error boundary для игровой сессии.
// Отображается при любом необработанном исключении в RSC или Client.

import { useEffect } from "react";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GameError({ error, reset }: Props) {
  useEffect(() => {
    console.error("[GameError]", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 bg-ocean-950 text-miss-white">
      <div className="w-full max-w-md rounded border border-hit-red/40 bg-ocean-900/90 p-8">
        <div className="mb-6 flex items-center gap-2 border-b border-hit-red/20 pb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-hit-red" style={{ animation: "morse-blink 0.8s step-end infinite" }} aria-hidden="true" />
          <span className="font-mono text-[9px] uppercase tracking-widest text-miss-white/30">
            SYSTEM ERROR
          </span>
        </div>

        <div className="space-y-3 font-mono">
          <p className="text-hit-red text-sm font-bold uppercase tracking-widest">
            ✕ Ошибка соединения
          </p>
          <p className="text-miss-white/50 text-xs">
            {error.message ?? "Неизвестная ошибка"}
          </p>
          {error.digest && (
            <p className="text-miss-white/20 text-[9px]">digest: {error.digest}</p>
          )}
        </div>
      </div>

      <div className="flex gap-4">
        <button
          type="button"
          onClick={reset}
          className="
            rounded border border-radar-green px-6 py-2
            font-mono text-sm uppercase tracking-widest text-radar-green
            hover:bg-radar-green hover:text-ocean-950
            transition-colors duration-150
          "
        >
          [ Повторить ]
        </button>
        <a
          href="/"
          className="
            rounded border border-ocean-800 px-6 py-2
            font-mono text-sm uppercase tracking-widest text-miss-white/50
            hover:border-ocean-700 hover:text-miss-white/80
            transition-colors duration-150
          "
        >
          [ Лобби ]
        </a>
      </div>
    </div>
  );
}
