"use client";

// apps/web/src/components/GameClientWrapper.tsx
// Клиентская оболочка игровой сессии.
// Генерирует playerId один раз через crypto.randomUUID() и сохраняет в sessionStorage
// (переживает навигацию в рамках одной вкладки, но не сохраняется между сессиями).
// Регистрирует playerId + roomId в Zustand-сторе через setSession().

import { useEffect } from "react";
import { useGameStore } from "@/src/store/gameStore";

// ── Заглушки игровых компонентов ──────────────────────────────────────────────
// Реальные компоненты (BoardGrid, RadarCanvas, MorseController) будут подключены
// в следующих фазах. Здесь — минимальные placeholder'ы для проверки структуры.

function BoardGridPlaceholder({ label }: { label: string }) {
  return (
    <div
      role="img"
      className="
        flex h-48 w-48 items-center justify-center rounded
        border border-[var(--color-ocean-800)]
        bg-[var(--color-ocean-900)] font-mono text-xs
        text-[var(--color-miss-white)]/40 uppercase tracking-widest
      "
      aria-label={label}
    >
      {label}
    </div>
  );
}

function RadarPlaceholder() {
  return (
    <div
      role="img"
      className="
        flex h-48 w-48 items-center justify-center rounded-full
        border border-[var(--color-radar-dim)]
        bg-[var(--color-ocean-900)] font-mono text-xs
        text-[var(--color-radar-green)]/40 uppercase tracking-widest
      "
      aria-label="Радар"
    >
      РАДАР
    </div>
  );
}

function MorsePlaceholder() {
  return (
    <div
      role="img"
      className="
        flex h-16 w-full max-w-sm items-center justify-center rounded
        border border-[var(--color-morse-amber)]/30
        bg-[var(--color-ocean-900)] font-mono text-xs
        text-[var(--color-morse-amber)]/40 uppercase tracking-widest
      "
      aria-label="Контроллер Морзе"
    >
      ▪ КОНТРОЛЛЕР МОРЗЕ ▪
    </div>
  );
}

// ── Ключ для sessionStorage ───────────────────────────────────────────────────

const PLAYER_ID_KEY = "radioboi:playerId";

// ── Основной компонент ────────────────────────────────────────────────────────

type Props = {
  roomId: string;
};

export function GameClientWrapper({ roomId }: Props) {
  const setSession = useGameStore((s) => s.setSession);
  const playerId = useGameStore((s) => s.playerId);

  useEffect(() => {
    // Если playerId уже инициализирован — ничего делать не нужно.
    // Используем реактивное значение из хука (а не imperative getState()).
    if (playerId) return;

    // Берём сохранённый playerId или генерируем новый.
    // sessionStorage гарантирует один и тот же ID на протяжении вкладки.
    let id = sessionStorage.getItem(PLAYER_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(PLAYER_ID_KEY, id);
    }

    setSession(id, roomId);
    // playerId в deps: если стор сброшен (reset()), эффект переинициализирует сессию.
  }, [roomId, setSession, playerId]);

  return (
    <main className="crt-scanlines flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-8">
      {/* ── Заголовок сессии ──────────────────────────────────────────────── */}
      <header className="text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-radar-green/60">
          КОМНАТА
        </p>
        <h1 className="font-mono text-2xl font-bold tracking-[0.3em] text-radar-green morse-glow">
          {roomId}
        </h1>
        {playerId && (
          <p className="mt-1 font-mono text-[10px] text-miss-white/30">
            ID: {playerId.slice(0, 8)}…
          </p>
        )}
      </header>

      {/* ── Игровые поля ─────────────────────────────────────────────────── */}
      <section
        className="flex flex-wrap items-start justify-center gap-8"
        aria-label="Игровые поля"
      >
        <div className="flex flex-col items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-miss-white/40">
            Ваше поле
          </span>
          <BoardGridPlaceholder label="Ваше поле" />
        </div>

        <div className="flex flex-col items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-miss-white/40">
            Поле противника
          </span>
          <BoardGridPlaceholder label="Поле противника" />
        </div>

        <div className="flex flex-col items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-miss-white/40">
            Радар
          </span>
          <RadarPlaceholder />
        </div>
      </section>

      {/* ── Морзе-контроллер ──────────────────────────────────────────────── */}
      <section aria-label="Ввод кода Морзе">
        <MorsePlaceholder />
      </section>
    </main>
  );
}