// apps/web/src/components/GameControls.tsx
"use client";

// FIX BUG (HIGH): Добавлен useEffect для синхронизации начальной скорости
// MorseEngine при монтировании. Без этого engine создаётся с DEFAULT_UNIT_MS=100мс,
// а UI показывает 20 WPM (=60мс) — несоответствие скорости воспроизведения
// входящего сигнала и отображаемого значения.

import type { MorseEngine } from "@radioboi/morse-engine";
import { useEffect, useRef, useState } from "react";
import { useGameStore } from "@/src/store/gameStore";

const VOLUME_MIN = 0;
const VOLUME_MAX = 100;
const VOLUME_DEFAULT = 80;

const PITCH_MIN = 440;
const PITCH_MAX = 800;
const PITCH_DEFAULT = 600;

const WPM_MIN = 10;
const WPM_MAX = 30;
const WPM_DEFAULT = 20;

const MAX_REPEATS = 3;

function wpmToUnitMs(wpm: number): number {
  return Math.round(1200 / wpm);
}

type Props = {
  engine: MorseEngine;
  currentIncomingSequence: number[] | null;
  currentMissileId: string | null;
  onSpeedChange?: (unitMs: number) => void;
};

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
      <div className="flex h-6 items-center">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-[var(--color-radar-green)]"
          aria-label={`${label}: ${displayValue ?? value}${unit}`}
        />
      </div>
    </div>
  );
}

export function GameControls({ engine, currentIncomingSequence, currentMissileId, onSpeedChange }: Props) {
  const phase = useGameStore((s) => s.phase);

  const [volume, setVolume] = useState(VOLUME_DEFAULT);
  const [pitch, setPitch] = useState(PITCH_DEFAULT);
  const [wpm, setWpm] = useState(WPM_DEFAULT);

  const [repeatCount, setRepeatCount] = useState(0);
  const lastMissileIdRef = useRef<string | null>(null);

  // FIX: Синхронизируем начальную скорость engine при монтировании.
  // engine создаётся с DEFAULT_UNIT_MS=100мс, но UI стартует с WPM_DEFAULT=20
  // (= 60мс). Без этого effect входящая ракета воспроизводится в 1.67× медленнее
  // чем показывает ползунок — игрок не может настроить скорость до первого изменения.
  useEffect(() => {
    const initialUnitMs = wpmToUnitMs(WPM_DEFAULT);
    engine.setSpeed(initialUnitMs);
    onSpeedChange?.(initialUnitMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]); // только при смене экземпляра движка

  useEffect(() => {
    if (currentMissileId === lastMissileIdRef.current) return;
    lastMissileIdRef.current = currentMissileId;
    setRepeatCount(0);
  }, [currentMissileId]);

  const isDefensePhase = phase === "battle" && currentIncomingSequence !== null;
  const canRepeat = isDefensePhase && repeatCount < MAX_REPEATS;

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
    engine.setSpeed(unitMs);
    onSpeedChange?.(unitMs);
  }

  function handleRepeat(): void {
    if (!canRepeat || !currentIncomingSequence) return;
    setRepeatCount((c) => c + 1);
    void engine.playSequence(currentIncomingSequence);
  }

  return (
    <section
      aria-label="Панель управления"
      className="
        rounded border border-[var(--color-ocean-800)]
        bg-[var(--color-ocean-900)] p-4
        font-mono w-full
      "
    >
      <header className="mb-4 flex items-center gap-2 border-b border-[var(--color-ocean-800)] pb-2">
        <span className="text-[var(--color-radar-green)]">▸</span>
        <h2 className="text-[9px] uppercase tracking-[0.25em] text-[var(--color-miss-white)]/40">
          RADIO CONTROLS
        </h2>
      </header>

      <div className="flex flex-col gap-4">
        <CrtSlider
          id="ctrl-volume"
          label="ГРОМКОСТЬ"
          unit="%"
          min={VOLUME_MIN}
          max={VOLUME_MAX}
          value={volume}
          onChange={handleVolumeChange}
        />

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