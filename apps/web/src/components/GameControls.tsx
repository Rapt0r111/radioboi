// apps/web/src/components/GameControls.tsx
"use client";

// Панель управления игрой в CRT-стиле.
// Содержит:
//  • Ползунок громкости (0–100%)
//  • Ползунок тональности Морзе (440–800 Гц)
//  • Ползунок скорости (10–30 WPM)
//  • Кнопка «Повторить сигнал» — только в фазе защиты, макс. 3 нажатия.
//
// FIX BUG 1: WPM-ползунок теперь вызывает engine.setSpeed() (для playSequence)
// И onSpeedChange(unitMs) — чтобы родитель передал unitMs в MorseTelegraph → FuzzyDecoder.

import type { MorseEngine } from "@radioboi/morse-engine";
import { useRef, useState } from "react";
import { useGameStore } from "@/src/store/gameStore";

// ── Constants ──────────────────────────────────────────────────────────────────

const VOLUME_MIN = 0;
const VOLUME_MAX = 100;
const VOLUME_DEFAULT = 80;

const PITCH_MIN = 440;
const PITCH_MAX = 800;
const PITCH_DEFAULT = 600;

const WPM_MIN = 10;
const WPM_MAX = 30;
const WPM_DEFAULT = 20;

/** Максимальное количество повторений одного входящего сигнала. */
const MAX_REPEATS = 3;

/**
 * Конвертирует WPM → длительность одной единицы в мс.
 * Стандарт PARIS: 1 WPM = 1200 мс / юнит.
 */
function wpmToUnitMs(wpm: number): number {
  return Math.round(1200 / wpm);
}

// ── Props ──────────────────────────────────────────────────────────────────────

type Props = {
  /** Экземпляр MorseEngine для управления аудио */
  engine: MorseEngine;
  /**
   * Текущая входящая Morse-последовательность (числа: >0 звук, <0 пауза).
   * Передаётся когда летит ракета (фаза защиты).
   */
  currentIncomingSequence: number[] | null;
  /** ID текущей летящей ракеты — сбрасывает счётчик повторений при смене */
  currentMissileId: string | null;
  /**
   * FIX BUG 1: Callback вызывается при изменении WPM с новым unitMs.
   * Родитель передаёт unitMs в MorseTelegraph → FuzzyDecoder.setDotDuration().
   */
  onSpeedChange?: (unitMs: number) => void;
};

// ── Вспомогательные компоненты ─────────────────────────────────────────────────

type SliderProps = {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  displayValue?: string;
};

function CrtSlider({ id, label, unit, min, max, value, onChange, displayValue }: SliderProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={id}
          className="font-mono text-[9px] uppercase tracking-widest text-[var(--color-miss-white)]/50"
        >
          {label}
        </label>
        <span className="font-mono text-[10px] tabular-nums text-[var(--color-radar-green)]">
          {displayValue ?? `${value}${unit}`}
        </span>
      </div>

      <div className="relative h-1.5 rounded-full bg-[var(--color-ocean-800)]">
        {/* Заполненная часть */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-radar-green)]"
          style={{ width: `${((value - min) / (max - min)) * 100}%` }}
          aria-hidden="true"
        />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="
            absolute inset-0 h-full w-full cursor-pointer opacity-0
            focus-visible:opacity-100
          "
          aria-label={`${label}: ${displayValue ?? value}${unit}`}
        />
      </div>
    </div>
  );
}

// ── Основной компонент ─────────────────────────────────────────────────────────

export function GameControls({ engine, currentIncomingSequence, currentMissileId, onSpeedChange }: Props) {
  const phase = useGameStore((s) => s.phase);

  // ── Состояние ползунков ───────────────────────────────────────────────────
  const [volume, setVolume] = useState(VOLUME_DEFAULT);
  const [pitch, setPitch] = useState(PITCH_DEFAULT);
  const [wpm, setWpm] = useState(WPM_DEFAULT);

  // ── Счётчик повторений — сбрасывается при смене ракеты ───────────────────
  const [repeatCount, setRepeatCount] = useState(0);
  const lastMissileIdRef = useRef<string | null>(null);

  // Сброс счётчика при появлении новой ракеты (без setState в render)
  if (currentMissileId !== lastMissileIdRef.current) {
    lastMissileIdRef.current = currentMissileId;
    if (repeatCount !== 0) {
      setRepeatCount(0);
    }
  }

  // ── Доступность кнопки повтора ────────────────────────────────────────────
  const isDefensePhase = phase === "battle" && currentIncomingSequence !== null;
  const canRepeat = isDefensePhase && repeatCount < MAX_REPEATS;

  // ── Обработчики ───────────────────────────────────────────────────────────

  function handleVolumeChange(v: number): void {
    setVolume(v);
    engine.setVolume(v / 100);
  }

  function handlePitchChange(v: number): void {
    setPitch(v);
    engine.setFrequency(v);
  }

  function handleWpmChange(v: number): void {
    setWpm(v);
    const unitMs = wpmToUnitMs(v);
    // FIX BUG 1: обновляем скорость воспроизведения в движке (для повтора сигнала)
    engine.setSpeed(unitMs);
    // FIX BUG 1: сообщаем родителю для синхронизации FuzzyDecoder
    onSpeedChange?.(unitMs);
  }

  function handleRepeat(): void {
    if (!canRepeat || !currentIncomingSequence) return;
    setRepeatCount((c) => c + 1);
    // FIX BUG 1: playSequence теперь без unitMs — движок сам использует setSpeed-значение
    void engine.playSequence(currentIncomingSequence);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section
      aria-label="Панель управления"
      className="
        rounded border border-[var(--color-ocean-800)]
        bg-[var(--color-ocean-900)] p-4
        font-mono
        w-full
      "
    >
      {/* Заголовок в стиле терминала */}
      <header className="mb-4 flex items-center gap-2 border-b border-[var(--color-ocean-800)] pb-2">
        <span className="text-[var(--color-radar-green)]">▸</span>
        <h2 className="text-[9px] uppercase tracking-[0.25em] text-[var(--color-miss-white)]/40">
          RADIO CONTROLS
        </h2>
      </header>

      <div className="flex flex-col gap-4">
        {/* ── Громкость ──────────────────────────────────────────────────── */}
        <CrtSlider
          id="ctrl-volume"
          label="ГРОМКОСТЬ"
          unit="%"
          min={VOLUME_MIN}
          max={VOLUME_MAX}
          value={volume}
          onChange={handleVolumeChange}
        />

        {/* ── Тональность ────────────────────────────────────────────────── */}
        <CrtSlider
          id="ctrl-pitch"
          label="ТОНАЛЬНОСТЬ"
          unit=" Гц"
          min={PITCH_MIN}
          max={PITCH_MAX}
          value={pitch}
          onChange={handlePitchChange}
          displayValue={`${pitch} Гц`}
        />

        {/* ── Скорость (WPM) ─────────────────────────────────────────────── */}
        <CrtSlider
          id="ctrl-wpm"
          label="СКОРОСТЬ"
          unit=" WPM"
          min={WPM_MIN}
          max={WPM_MAX}
          value={wpm}
          onChange={handleWpmChange}
          displayValue={`${wpm} WPM · ${wpmToUnitMs(wpm)}мс`}
        />

        {/* ── Кнопка повтора сигнала ──────────────────────────────────────── */}
        <div className="mt-1 border-t border-[var(--color-ocean-800)] pt-3">
          <button
            type="button"
            onClick={handleRepeat}
            disabled={!canRepeat}
            aria-label={`Повторить сигнал (осталось ${MAX_REPEATS - repeatCount} из ${MAX_REPEATS})`}
            className="
              group relative w-full rounded border px-3 py-2
              text-[10px] uppercase tracking-[0.2em]
              transition-all duration-150
              disabled:cursor-not-allowed
              disabled:border-[var(--color-ocean-800)]
              disabled:text-[var(--color-miss-white)]/20
              enabled:border-[var(--color-morse-amber)]/70
              enabled:text-[var(--color-morse-amber)]
              enabled:hover:bg-[var(--color-morse-amber)]/10
              enabled:hover:border-[var(--color-morse-amber)]
              focus-visible:outline-none
              focus-visible:ring-1
              focus-visible:ring-[var(--color-morse-amber)]
            "
          >
            <span className="flex items-center justify-center gap-2">
              <span>▶ ПОВТОРИТЬ СИГНАЛ</span>

              {/* Пипки счётчика повторений */}
              <span className="flex gap-0.5" aria-hidden="true">
                {Array.from({ length: MAX_REPEATS }).map((_, i) => (
                  <span
                    key={i}
                    className={
                      i < repeatCount
                        ? "h-1.5 w-1.5 rounded-full bg-[var(--color-hit-red)]"
                        : "h-1.5 w-1.5 rounded-full bg-[var(--color-ocean-800)] group-enabled:bg-[var(--color-morse-amber)]/40"
                    }
                  />
                ))}
              </span>
            </span>
          </button>

          {/* Статус кнопки */}
          <p className="mt-1.5 text-center text-[8px] uppercase tracking-widest text-[var(--color-miss-white)]/25">
            {!isDefensePhase
              ? "недоступно вне фазы защиты"
              : repeatCount >= MAX_REPEATS
                ? "лимит повторений исчерпан"
                : `осталось попыток: ${MAX_REPEATS - repeatCount}`}
          </p>
        </div>
      </div>
    </section>
  );
}