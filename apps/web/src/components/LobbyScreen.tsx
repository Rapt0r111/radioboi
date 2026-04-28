// apps/web/src/components/LobbyScreen.tsx
"use client";

// Экран лобби — показывается пока не подключился второй игрок.
// Сервер переводит комнату в phase="placement" когда оба игрока
// подключились (addPlayer → players.length === 2).

type Props = {
  roomId: string;
};

export function LobbyScreen({ roomId }: Props) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 bg-ocean-950">
      <header className="text-center">
        <h1
          className="font-mono text-3xl font-bold tracking-[0.25em] text-radar-green"
          style={{ textShadow: "0 0 16px rgba(0,255,136,0.35)" }}
        >
          ▸ МОРСКОЙ РАДИОБОЙ
        </h1>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.3em] text-miss-white/40">
          Комната создана · Ожидание второго игрока
        </p>
      </header>

      {/* Карточка-терминал */}
      <div className="w-full max-w-sm rounded border border-radar-green/30 bg-ocean-900/80 p-6">
        <div className="mb-5 flex items-center gap-2 border-b border-radar-green/20 pb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-hit-red" aria-hidden="true" />
          <span className="h-1.5 w-1.5 rounded-full bg-morse-amber" aria-hidden="true" />
          <span className="h-1.5 w-1.5 rounded-full bg-radar-green" aria-hidden="true" />
          <span className="ml-2 font-mono text-[9px] uppercase tracking-widest text-miss-white/30">
            RADIOBOI v0.1
          </span>
        </div>

        <div className="space-y-2 font-mono text-sm">
          <p className="text-radar-green/70">
            <span className="text-radar-green">$</span> create-room --secure
          </p>
          <p className="text-miss-white/60">▸ КОМНАТА СОЗДАНА: {roomId}</p>
          <p className="text-miss-white/40">▸ ОЖИДАНИЕ ПРОТИВНИКА...</p>
        </div>
      </div>

      {/* Код комнаты */}
      <div className="flex flex-col items-center gap-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-miss-white/30">
          Код комнаты для второго игрока
        </p>
        <div
          className="rounded border border-radar-green/30 px-8 py-4"
          style={{ boxShadow: "0 0 24px rgba(0,255,136,0.08)" }}
        >
          <p className="font-mono text-4xl font-bold tracking-[0.6em] text-radar-green">
            {roomId}
          </p>
        </div>
        <p className="font-mono text-[9px] uppercase tracking-widest text-miss-white/20">
          Перейти на radioboi.app и ввести код
        </p>
      </div>

      {/* Индикатор ожидания */}
      <div className="flex items-center gap-3 font-mono text-xs text-miss-white/30">
        <span
          className="inline-block h-2 w-2 rounded-full bg-morse-amber"
          style={{ animation: "morse-blink 1s step-end infinite" }}
          aria-hidden="true"
        />
        <span className="uppercase tracking-widest">1/2 игроков онлайн</span>
      </div>
    </div>
  );
}
