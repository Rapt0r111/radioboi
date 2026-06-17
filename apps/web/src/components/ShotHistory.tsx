// apps/web/src/components/ShotHistory.tsx
"use client";

// История ходов — отображает все выстрелы текущей партии в хронологическом порядке.
// Данные берутся из gameStore.shotLog, который заполняется в useGameLoop
// при каждом RESOLVE_HIT-событии.

import type { ShotLogEntry } from "@/src/store/gameStore";
import { useGameStore } from "@/src/store/gameStore";
import { useEffect, useRef } from "react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function resultLabel(result: ShotLogEntry["result"]): { text: string; color: string } {
  switch (result) {
    case "hit":
      return { text: "РАНЕН", color: "text-[var(--color-morse-amber)]" };
    case "sunk":
      return { text: "ПОТОПЛЕН", color: "text-[var(--color-hit-red)]" };
    case "miss":
      return { text: "МИМО", color: "text-[var(--color-miss-white)]/40" };
  }
}

function resultIcon(result: ShotLogEntry["result"]): string {
  switch (result) {
    case "hit":  return "✕";
    case "sunk": return "✕";
    case "miss": return "·";
  }
}

// ── Компонент ─────────────────────────────────────────────────────────────────

export function ShotHistory() {
  const shotLog = useGameStore((s) => s.shotLog);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Авто-прокрутка вниз при появлении нового хода
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  });

  return (
    <section
      aria-label="История ходов"
      className="flex flex-col rounded border border-ocean-800 bg-ocean-900 overflow-hidden"
    >
      {/* Заголовок */}
      <header className="flex items-center gap-2 border-b border-ocean-800 px-3 py-2">
        <span className="text-radar-green text-[10px]">▸</span>
        <h2 className="font-mono text-[9px] uppercase tracking-[0.25em] text-miss-white/40">
          ИСТОРИЯ ХОДОВ
        </h2>
        <span className="ml-auto font-mono text-[9px] tabular-nums text-miss-white/25">
          {shotLog.length}
        </span>
      </header>

      {/* Список */}
      <div
        ref={scrollRef}
        className="flex flex-col gap-0.5 overflow-y-auto p-2"
        style={{ maxHeight: "240px" }}
        role="log"
        aria-live="polite"
        aria-atomic="false"
      >
        {shotLog.length === 0 ? (
          <p className="px-2 py-4 text-center font-mono text-[9px] uppercase tracking-widest text-miss-white/20">
            Ходов ещё не было
          </p>
        ) : (
          shotLog.map((entry, index) => {
            const { text, color } = resultLabel(entry.result);
            const icon = resultIcon(entry.result);
            const isByMe = entry.by === "us";

            return (
              <div
                key={`${entry.ts}-${entry.by}-${entry.coord}-${entry.result}`}
                className={`flex items-center gap-2 rounded px-2 py-1 font-mono text-[10px] transition-colors ${
                  isByMe
                    ? "bg-radar-green/5"
                    : "bg-ocean-800/40"
                }`}
              >
                {/* Номер хода */}
                <span className="w-5 shrink-0 text-right tabular-nums text-miss-white/20">
                  {index + 1}
                </span>

                {/* Кто стрелял */}
                <span
                  className={`w-4 shrink-0 text-center text-[9px] uppercase ${
                    isByMe
                      ? "text-radar-green/70"
                      : "text-miss-white/30"
                  }`}
                  title={isByMe ? "Ваш выстрел" : "Выстрел противника"}
                >
                  {isByMe ? "Я" : "∇"}
                </span>

                {/* Координата */}
                <span className="flex-1 tracking-wider text-miss-white/70">
                  {entry.coord}
                </span>

                {/* Результат */}
                <span className={`shrink-0 text-[9px] uppercase tracking-widest ${color}`}>
                  {icon} {text}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}