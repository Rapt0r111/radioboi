// apps/web/src/components/MorseTelegraph.tsx
"use client";

import {
  COLUMNS,
  type Coordinate,
  morseLetterToColIndex,
  morseNotationToCoordinate,
  ROWS,
} from "@radioboi/game-core";
import { FuzzyDecoder, type MorseEngine } from "@radioboi/morse-engine";
import { useEffect, useEffectEvent, useRef, useState } from "react";

const LIVE_TONE_SEQUENCE = [30_000];
const LIVE_TONE_UNIT_MS = 1;
const DISPLAY_SLOTS = 6;

type Props = {
  mode: "attack" | "intercept";
  morseEngine?: MorseEngine | null;
  onSequenceComplete(coord: Coordinate): void;
  /**
   * FIX BUG 1: длительность единицы Морзе в мс, синхронизируется с WPM-ползунком.
   * При изменении обновляет FuzzyDecoder.setDotDuration().
   * По умолчанию 60мс (20 WPM).
   */
  unitMs?: number;
  /**
   * FIX BUG 2: показывает визуальный фидбек «неверный перехват».
   * Подсвечивает кнопку красным на 600мс.
   */
  showWrongFeedback?: boolean;
};

function toDisplayChars(decodedChars: readonly string[]): string[] {
  if (decodedChars.length === 0) {
    return Array.from({ length: DISPLAY_SLOTS }, () => "");
  }

  const [letter = "", digit = ""] = decodedChars;
  const display = Array.from({ length: DISPLAY_SLOTS }, () => "");

  if (letter) {
    try {
      const triplet = COLUMNS[morseLetterToColIndex(letter)];

      if (triplet !== undefined) {
        const chars = [...triplet];

        for (const [index, char] of chars.entries()) {
          display[index] = char;
        }
      }
    } catch {
      display[0] = letter;
    }
  }

  if (digit && /^[0-9]$/.test(digit)) {
    const row = ROWS[Number(digit)];

    if (row !== undefined) {
      const chars = [...row];

      for (const [index, char] of chars.entries()) {
        display[index + 3] = char;
      }
    }
  }

  return display;
}

export function MorseTelegraph({
  mode,
  morseEngine = null,
  onSequenceComplete,
  unitMs = 60,
  showWrongFeedback = false,
}: Props) {
  const [decodedChars, setDecodedChars] = useState<string[]>([]);
  const [isPressed, setIsPressed] = useState(false);
  const [liveMorse, setLiveMorse] = useState("");
  // FIX BUG 2: локальный флаг для flash-анимации «неверно»
  const [isWrongFlash, setIsWrongFlash] = useState(false);
  const decoderRef = useRef<FuzzyDecoder | null>(null);
  const wrongFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const completeSequence = useEffectEvent((chars: readonly string[]) => {
    const [letter, digit] = chars;

    if (!letter || !digit) {
      return;
    }

    try {
      const coord = morseNotationToCoordinate(letter, digit);
      onSequenceComplete(coord);
    } catch {
      // Ignore invalid tokens and let the player retry.
    }
  });

  if (decoderRef.current === null) {
    decoderRef.current = new FuzzyDecoder({
      dotDuration: unitMs,
      onChar: (char) => {
        setLiveMorse("");
        setDecodedChars((current) => {
          const normalizedChar = char.toUpperCase();
          const next = [...current, normalizedChar];

          if (next.length === 1 && !/^[A-J]$/.test(next[0] ?? "")) {
            return [];
          }

          if (next.length === 2) {
            if (!/^[0-9]$/.test(next[1] ?? "")) {
              return [];
            }

            queueMicrotask(() => completeSequence(next));
            return [];
          }

          return next;
        });
      },
      onSymbol: (symbol) => {
        setLiveMorse((current) => current + symbol);
      },
      onWordBreak: () => {
        setLiveMorse("");
      },
    });
  }

  // FIX BUG 1: синхронизируем dotDuration декодера при изменении WPM
  useEffect(() => {
    decoderRef.current?.setDotDuration(unitMs);
  }, [unitMs]);

  useEffect(() => {
    decoderRef.current?.reset();
    setDecodedChars([]);
    setLiveMorse("");
    setIsPressed(false);
  }, [mode]);

  // FIX BUG 2: flash-анимация при неверном перехвате
  useEffect(() => {
    if (!showWrongFeedback) return;

    // Сбрасываем предыдущий таймер если ещё горит
    if (wrongFlashTimerRef.current !== null) {
      clearTimeout(wrongFlashTimerRef.current);
    }

    setIsWrongFlash(true);
    wrongFlashTimerRef.current = setTimeout(() => {
      setIsWrongFlash(false);
      wrongFlashTimerRef.current = null;
    }, 600);

    return () => {
      if (wrongFlashTimerRef.current !== null) {
        clearTimeout(wrongFlashTimerRef.current);
      }
    };
  }, [showWrongFeedback]);

  function releaseKey(pointerId: number, target: EventTarget & HTMLButtonElement): void {
    if (target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }

    decoderRef.current?.pointerUp(performance.now());
    morseEngine?.stop();
    setIsPressed(false);
  }

  const displayChars = toDisplayChars(decodedChars);

  // FIX BUG 2: динамические классы кнопки при ошибке перехвата
  const buttonBorderClass = isWrongFlash
    ? "border-[var(--color-hit-red)]"
    : "border-green-500";

  const buttonBgClass = isWrongFlash
    ? "bg-[radial-gradient(circle_at_top,rgba(255,59,59,0.22),transparent_58%),linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))]"
    : "bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.18),transparent_58%),linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))]";

  return (
    <section
      aria-label={mode === "attack" ? "Передача координат Морзе" : "Перехват ракеты по Морзе"}
      className="flex w-full flex-col gap-4 rounded border border-green-500/40 bg-black/60 p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-green-500/60">
            {mode === "attack" ? "ATTACK KEY" : "INTERCEPT KEY"}
          </p>
          <p className="font-mono text-xs text-miss-white/45">
            {mode === "attack"
              ? "Передайте выбранную цель точно."
              : "Примите сигнал и введите координату вручную."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* FIX BUG 2: индикатор ошибки перехвата */}
          {isWrongFlash && (
            <div
              className="rounded border border-[var(--color-hit-red)]/60 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-[var(--color-hit-red)]"
              role="alert"
              aria-live="assertive"
            >
              ✕ НЕВЕРНО
            </div>
          )}
          <div
            className={`rounded border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors duration-150 ${
              isWrongFlash
                ? "border-[var(--color-hit-red)]/60 text-[var(--color-hit-red)]"
                : "border-green-500/30 text-green-400"
            }`}
          >
            {liveMorse || "READY"}
          </div>
        </div>
      </div>

      {/* Декодированные символы */}
      <div className="grid grid-cols-6 gap-2">
        {displayChars.map((char, index) => (
          <div
            key={`${index}-${char || "empty"}`}
            className={`flex h-11 items-center justify-center rounded border font-mono text-lg shadow-[0_0_10px_rgba(34,197,94,0.15)] transition-colors duration-150 ${
              isWrongFlash
                ? "border-[var(--color-hit-red)]/40 bg-[var(--color-hit-red)]/5 text-[var(--color-hit-red)]/70"
                : char
                  ? "border-green-400/60 bg-green-500/10 text-green-300"
                  : "border-green-500/30 bg-green-500/5 text-green-300/40"
            }`}
          >
            {char || "·"}
          </div>
        ))}
      </div>

      {/* Кнопка телеграфного ключа */}
      <button
        type="button"
        className={`
          relative flex min-h-28 w-full items-center justify-center overflow-hidden rounded-xl
          border-2 font-mono text-sm uppercase tracking-[0.35em] text-green-100
          transition-all duration-100 select-none touch-none
          hover:text-green-50
          active:translate-y-1 active:shadow-[0_0_28px_rgba(34,197,94,0.55)]
          ${buttonBorderClass} ${buttonBgClass}
        `}
        onPointerCancel={(event) => {
          releaseKey(event.pointerId, event.currentTarget);
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          decoderRef.current?.pointerDown(performance.now());
          void morseEngine?.playSequence(LIVE_TONE_SEQUENCE, LIVE_TONE_UNIT_MS);
          setIsPressed(true);
        }}
        onPointerUp={(event) => {
          releaseKey(event.pointerId, event.currentTarget);
        }}
      >
        <span
          className={`absolute inset-0 transition-opacity duration-75 ${
            isWrongFlash
              ? "bg-[var(--color-hit-red)]/8 opacity-100"
              : isPressed
                ? "bg-green-500/10 opacity-100"
                : "opacity-0"
          }`}
        />
        <span className="absolute inset-x-4 top-4 h-px bg-green-500/30" aria-hidden="true" />
        <span className="absolute inset-x-4 bottom-4 h-px bg-green-500/20" aria-hidden="true" />

        {/* FIX BUG 2: текст кнопки меняется при ошибке */}
        <span className="relative z-10">
          {isWrongFlash ? "✕ НЕВЕРНАЯ РАСШИФРОВКА" : isPressed ? "TRANSMITTING" : "PRESS TO KEY"}
        </span>
      </button>

      {/* Подсказка по скорости */}
      <p className="text-center font-mono text-[8px] uppercase tracking-widest text-miss-white/20">
        {unitMs}мс/ед · точка &lt; {Math.round(unitMs * 1.3)}мс · тире &gt; {Math.round(unitMs * 1.5)}мс
      </p>
    </section>
  );
}