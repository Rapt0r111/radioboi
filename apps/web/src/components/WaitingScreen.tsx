// apps/web/src/components/WaitingScreen.tsx
"use client";

// Экран ожидания — показывается после расстановки кораблей, пока
// второй игрок не расставит свои. CRT-терминал с анимацией Морзе.

type Props = {
  roomId: string;
};

export function WaitingScreen({ roomId }: Props) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 bg-ocean-950">
      <div className="w-full max-w-md rounded border border-radar-green/30 bg-ocean-900/80 p-8">
        {/* Заголовок терминала */}
        <div className="mb-6 flex items-center gap-2 border-b border-radar-green/20 pb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-hit-red" aria-hidden="true" />
          <span className="h-1.5 w-1.5 rounded-full bg-morse-amber" aria-hidden="true" />
          <span className="h-1.5 w-1.5 rounded-full bg-radar-green" aria-hidden="true" />
          <span className="ml-2 font-mono text-[9px] uppercase tracking-widest text-miss-white/30">
            ROOM {roomId} · SECURE CHANNEL
          </span>
        </div>

        {/* Содержимое */}
        <div className="space-y-3 font-mono text-sm">
          <p className="text-radar-green/80">
            <span className="text-radar-green">$</span> await opponent --ready
          </p>
          <p className="text-miss-white/70">▸ ФЛОТ РАССТАВЛЕН. ОЖИДАНИЕ ПРОТИВНИКА...</p>
          <p className="text-miss-white/40">▸ СИНХРОНИЗАЦИЯ РАДАРНОГО КАНАЛА...</p>

          {/* Анимированные точки */}
          <div className="mt-6 flex items-center gap-3">
            <span className="text-radar-green uppercase tracking-widest text-xs">
              ОЖИДАНИЕ
            </span>
            <span
              className="font-mono text-radar-green/60"
              style={{ animation: "morse-blink 1.2s step-end infinite" }}
              aria-hidden="true"
            >
              · — · —
            </span>
          </div>
        </div>
      </div>

      {/* Подсказка */}
      <p className="font-mono text-[10px] uppercase tracking-widest text-miss-white/20">
        Поделитесь кодом комнаты с противником: {roomId}
      </p>

      {/* Код комнаты крупно */}
      <div
        className="rounded border border-radar-green/20 px-6 py-3"
        style={{ boxShadow: "0 0 20px rgba(0,255,136,0.06)" }}
      >
        <p className="font-mono text-3xl font-bold tracking-[0.5em] text-radar-green">
          {roomId}
        </p>
      </div>
    </div>
  );
}
