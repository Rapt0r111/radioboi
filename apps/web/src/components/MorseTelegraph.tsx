// apps/web/src/components/MorseTelegraph.tsx
"use client";

// FIX (MEDIUM): FuzzyDecoder создаётся через useRef с lazy initializer через
// useMemo-паттерн. Ранее decoder создавался в теле рендера ("if ref===null"),
// что означало что при React Strict Mode double-invoke первый decoder
// терялся и onChar замыкался на stale completeSequence.
// Теперь decoder создаётся один раз через useRef с функцией-инициализатором.
//
// FIX (LOW): unitMs корректно применяется при первом рендере и при изменении.
// Ранее FuzzyDecoder создавался с dotDuration из начального unitMs пропа,
// но effect для setDotDuration срабатывал ПОСЛЕ первого рендера — краткий
// период несоответствия. Теперь decoder инициализируется с актуальным unitMs.

import {
  BOARD_COLUMN_LABELS,
  BOARD_ROW_LABELS,
  COLUMN_MORSE_DIGITS,
  type Coordinate,
  morseNotationToCoordinate,
  type DifficultyMode,
} from "@radioboi/game-core";
import { FuzzyDecoder, type MorseEngine } from "@radioboi/morse-engine";
import {
  applyMorseInputChar,
  BOARD_REVERSE_MORSE,
  type MorseExpectedParts,
  type MorseInputPart,
} from "@/src/lib/morseInput";
import { useEffect, useEffectEvent, useRef, useState } from "react";

const DISPLAY_SLOTS = 2;
const DISPLAY_SLOT_KEYS = Array.from({ length: DISPLAY_SLOTS }, (_, index) => `display-slot-${index + 1}`);

function normalizeDecodedChar(char: string, slotIndex: number): string {
  const upper = char.toUpperCase();
  if (slotIndex !== 0) return upper;
  return upper === "Ё" ? "Е" : upper;
}

type Props = {
  mode: "attack" | "intercept";
  morseEngine?: MorseEngine | null;
  onSequenceComplete(coord: Coordinate): void;
  unitMs?: number;
  difficulty?: DifficultyMode;
  expectedNotation?: MorseExpectedParts | null;
  onInputError?(part: MorseInputPart): void;
  showWrongFeedback?: boolean;
  showHints?: boolean;
  resetToken?: number;
};

function toDisplayChars(decodedChars: readonly string[]): string[] {
  if (decodedChars.length === 0) {
    return Array.from({ length: DISPLAY_SLOTS }, () => "");
  }

  const [letter = "", digit = ""] = decodedChars;
  const display = Array.from({ length: DISPLAY_SLOTS }, () => "");

  if (letter) {
    display[0] = letter;
  }

  if (digit) {
    const colIndex = COLUMN_MORSE_DIGITS.indexOf(
      digit as (typeof COLUMN_MORSE_DIGITS)[number],
    );
    if (colIndex >= 0) {
      display[1] = BOARD_COLUMN_LABELS[colIndex] ?? digit;
    }
  }

  return display;
}

export function MorseTelegraph({
  mode,
  morseEngine = null,
  onSequenceComplete,
  unitMs = 60,
  difficulty = "normal",
  expectedNotation = null,
  onInputError,
  showWrongFeedback = false,
  showHints = true,
  resetToken = 0,
}: Props) {
  const [decodedChars, setDecodedChars] = useState<string[]>([]);
  const [isPressed, setIsPressed] = useState(false);
  const [liveMorse, setLiveMorse] = useState("");
  const [isWrongFlash, setIsWrongFlash] = useState(false);

  // FIX: храним текущий unitMs в ref чтобы lazy-инициализатор декодера
  // всегда читал актуальное значение даже при re-mount
  const unitMsRef = useRef(unitMs);
  unitMsRef.current = unitMs;

  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;
  const expectedNotationRef = useRef<MorseExpectedParts | null>(expectedNotation);
  expectedNotationRef.current = expectedNotation;

  const isPressedRef = useRef(false);
  const previousModeRef = useRef(mode);
  const previousExpectedKeyRef = useRef(
    `${expectedNotation?.letter ?? ""}:${expectedNotation?.digit ?? ""}`,
  );
  const previousResetTokenRef = useRef(resetToken);
  const wrongFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const completeSequence = useEffectEvent((chars: readonly string[]) => {
    const [letter, digit] = chars;
    if (!letter || !digit) return;
    try {
      const coord = morseNotationToCoordinate(letter, digit);
      onSequenceComplete(coord);
    } catch {
      // ignore invalid tokens
    }
  });

  const reportInputError = useEffectEvent((part: MorseInputPart) => {
    onInputError?.(part);
  });

  // FIX: Decoder инициализируется с актуальным unitMs через ref.
  // Это устраняет brief mismatch при первом рендере когда effect ещё не запустился.
  const decoderRef = useRef<FuzzyDecoder | null>(null);
  if (decoderRef.current === null) {
    decoderRef.current = new FuzzyDecoder({
      dotDuration: unitMsRef.current, // ← актуальный unitMs через ref
      reverseMap: BOARD_REVERSE_MORSE,
      onChar: (char) => {
        setLiveMorse("");
        setDecodedChars((current) => {
          const normalizedChar = normalizeDecodedChar(char, current.length);
          const inputResult = applyMorseInputChar(
            current,
            normalizedChar,
            expectedNotationRef.current,
            difficultyRef.current === "beginner",
          );
          const wrongPart = inputResult.wrongPart;
          if (wrongPart !== undefined) {
            queueMicrotask(() => reportInputError(wrongPart));
          }
          const next = inputResult.chars;

          const row = next[0] ?? "";
          if (
            next.length === 1 &&
            !BOARD_ROW_LABELS.includes(row as (typeof BOARD_ROW_LABELS)[number])
          ) {
            return [];
          }

          if (next.length === 2) {
            const digit = next[1] ?? "";
            if (!COLUMN_MORSE_DIGITS.includes(digit as (typeof COLUMN_MORSE_DIGITS)[number])) {
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

  // Синхронизируем dotDuration при изменении unitMs
  useEffect(() => {
    decoderRef.current?.setDotDuration(unitMs);
  }, [unitMs]);

  // Сброс состояния при смене режима (attack ↔ intercept)
  useEffect(() => {
    if (previousModeRef.current === mode) return;
    previousModeRef.current = mode;
    decoderRef.current?.reset();
    setDecodedChars([]);
    setLiveMorse("");
    isPressedRef.current = false;
    setIsPressed(false);
  });

  useEffect(() => {
    const nextExpectedKey = `${expectedNotation?.letter ?? ""}:${expectedNotation?.digit ?? ""}`;
    if (previousExpectedKeyRef.current === nextExpectedKey) return;
    previousExpectedKeyRef.current = nextExpectedKey;
    decoderRef.current?.reset();
    setDecodedChars([]);
    setLiveMorse("");
  }, [expectedNotation?.digit, expectedNotation?.letter]);

  useEffect(() => {
    if (previousResetTokenRef.current === resetToken) return;
    previousResetTokenRef.current = resetToken;
    decoderRef.current?.reset();
    setDecodedChars([]);
    setLiveMorse("");
    isPressedRef.current = false;
    setIsPressed(false);
  }, [resetToken]);

  // Flash-анимация при неверном перехвате
  useEffect(() => {
    if (!showWrongFeedback) return;

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

  function startSignal(): void {
    if (isPressedRef.current) return;
    isPressedRef.current = true;
    morseEngine?.startTone();
    decoderRef.current?.pointerDown(performance.now());
    setIsPressed(true);
  }

  function stopSignal(): void {
    if (!isPressedRef.current) return;
    isPressedRef.current = false;
    decoderRef.current?.pointerUp(performance.now());
    morseEngine?.stopTone();
    setIsPressed(false);
  }

  function releaseKey(pointerId: number, target: EventTarget & HTMLButtonElement): void {
    if (target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    stopSignal();
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName.toLowerCase();
    return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.code !== "Space" || isEditableTarget(event.target)) return;
      event.preventDefault();
      if (event.repeat) return;
      startSignal();
    }

    function onKeyUp(event: KeyboardEvent): void {
      if (event.code !== "Space" || isEditableTarget(event.target)) return;
      event.preventDefault();
      stopSignal();
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
    };
  });

  const displayChars = toDisplayChars(decodedChars);

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
          {showHints ? (
            <p className="font-mono text-xs text-miss-white/45">
              {mode === "attack"
                ? "Передайте выбранную цель точно."
                : "Примите сигнал и введите координату вручную."}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {isWrongFlash && (
            <div
              className="rounded border border-hit-red/60 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-hit-red"
              role="alert"
              aria-live="assertive"
            >
              ✕ НЕВЕРНО
            </div>
          )}
          <div
            className={`rounded border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors duration-150 ${
              isWrongFlash
                ? "border-hit-red/60 text-hit-red"
                : "border-green-500/30 text-green-400"
            }`}
          >
            {liveMorse || "READY"}
          </div>
        </div>
      </div>

      {/* Декодированные символы */}
      <div className="grid grid-cols-2 gap-2">
        {DISPLAY_SLOT_KEYS.map((slotKey, index) => {
          const char = displayChars[index] ?? "";

          return (
          <div
            key={slotKey}
            className={`flex h-11 items-center justify-center rounded border font-mono text-lg shadow-[0_0_10px_rgba(34,197,94,0.15)] transition-colors duration-150 ${
              isWrongFlash
                ? "border-hit-red/40 bg-hit-red/5 text-hit-red/70"
                : char
                  ? "border-green-400/60 bg-green-500/10 text-green-300"
                  : "border-green-500/30 bg-green-500/5 text-green-300/40"
            }`}
          >
            {char || "·"}
          </div>
          );
        })}
      </div>

      {/* Кнопка телеграфного ключа */}
      <button
        type="button"
        aria-label={mode === "attack" ? "Передать выбранную координату Морзе" : "Ввести координату перехвата Морзе"}
        className={`
          relative flex min-h-28 w-full items-center justify-center overflow-hidden rounded-lg
          border-2 font-mono text-sm uppercase tracking-normal text-green-100
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
          startSignal();
        }}
        onPointerUp={(event) => {
          releaseKey(event.pointerId, event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          event.preventDefault();
          if (event.repeat) return;
          startSignal();
        }}
        onKeyUp={(event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          event.preventDefault();
          stopSignal();
        }}
        onBlur={stopSignal}
      >
        <span
          className={`absolute inset-0 transition-opacity duration-75 ${
            isWrongFlash
              ? "bg-hit-red/8 opacity-100"
              : isPressed
                ? "bg-green-500/10 opacity-100"
                : "opacity-0"
          }`}
        />
        <span className="absolute inset-x-4 top-4 h-px bg-green-500/30" aria-hidden="true" />
        <span className="absolute inset-x-4 bottom-4 h-px bg-green-500/20" aria-hidden="true" />

        <span className="relative z-10">
          {isWrongFlash ? "✕ НЕВЕРНАЯ РАСШИФРОВКА" : isPressed ? "TRANSMITTING" : "PRESS TO KEY"}
        </span>
      </button>

      {showHints ? (
        <p className="text-center font-mono text-[8px] uppercase tracking-widest text-miss-white/20">
          {unitMs}мс/ед · точка &lt; {Math.round(unitMs * 1.3)}мс · тире &gt; {Math.round(unitMs * 1.5)}мс
        </p>
      ) : null}
    </section>
  );
}
