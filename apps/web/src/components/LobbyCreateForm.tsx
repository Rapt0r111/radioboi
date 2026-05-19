"use client";

// apps/web/src/components/LobbyCreateForm.tsx
//
// Interactive room creation form with configurable settings panel.
// Handles both "Create Room" and "Join Room" flows.
// Uses createRoomAction with settings; navigates on success.

import type { RoomSettings } from "@radioboi/game-core";
import { DEFAULT_ROOM_SETTINGS } from "@radioboi/game-core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createRoomAction, joinRoomAction } from "../../app/actions";

const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const SETTINGS_PRESETS: Array<{ id: string; label: string; settings: RoomSettings }> = [
  {
    id: "classic",
    label: "CLASSIC",
    settings: DEFAULT_ROOM_SETTINGS,
  },
  {
    id: "rapid",
    label: "RAPID",
    settings: {
      battleMode: "turn-based",
      attackCooldownMs: 10_000,
      interceptWindowMs: 15_000,
      maxInterceptAttempts: 2,
    },
  },
  {
    id: "async",
    label: "ASYNC",
    settings: {
      battleMode: "async",
      attackCooldownMs: 20_000,
      interceptWindowMs: 25_000,
      maxInterceptAttempts: 3,
    },
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

type ToggleProps = {
  id: string;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
};

function CrtToggle({ id, label, value, onChange }: ToggleProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={id} className="font-mono text-xs uppercase tracking-widest text-miss-white/60">
        {label}
      </label>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={cx(
          "relative h-6 w-12 rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-green",
          value ? "border-radar-green bg-radar-green/20" : "border-ocean-800 bg-ocean-900",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full transition-transform duration-200",
            value ? "translate-x-6 bg-radar-green" : "translate-x-0 bg-ocean-700",
          )}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

type SliderProps = {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  disabled?: boolean;
};

function CrtSlider({ id, label, min, max, step, value, onChange, format, disabled }: SliderProps) {
  return (
    <div className={cx("flex flex-col gap-1", disabled && "opacity-35 pointer-events-none")}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="font-mono text-xs uppercase tracking-widest text-miss-white/60">
          {label}
        </label>
        <span className="font-mono text-xs tabular-nums text-radar-green">
          {format(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="h-2 w-full cursor-pointer accent-radar-green"
      />
    </div>
  );
}

type SegmentProps = {
  id: string;
  label: string;
  options: { value: number; label: string }[];
  value: number;
  onChange: (v: number) => void;
};

function CrtSegment({ id, label, options, value, onChange }: SegmentProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-mono text-xs uppercase tracking-widest text-miss-white/60">
        {label}
      </legend>
      <div id={id} className="flex gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
            className={cx(
              "flex-1 rounded border px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors duration-150",
              value === opt.value
                ? "border-radar-green bg-radar-green/15 text-radar-green"
                : "border-ocean-800 text-miss-white/40 hover:border-ocean-700 hover:text-miss-white/60",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  initialError?: string;
};

export function LobbyCreateForm({ initialError }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [showSettings, setShowSettings] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState(initialError ?? "");

  // ── Room settings state ────────────────────────────────────────────────────
  const [isAsync, setIsAsync] = useState(DEFAULT_ROOM_SETTINGS.battleMode === "async");
  const [cooldownMs, setCooldownMs] = useState(DEFAULT_ROOM_SETTINGS.attackCooldownMs);
  const [interceptMs, setInterceptMs] = useState(DEFAULT_ROOM_SETTINGS.interceptWindowMs);
  const [maxAttempts, setMaxAttempts] = useState(DEFAULT_ROOM_SETTINGS.maxInterceptAttempts);

  function applySettings(settings: RoomSettings): void {
    setIsAsync(settings.battleMode === "async");
    setCooldownMs(settings.attackCooldownMs);
    setInterceptMs(settings.interceptWindowMs);
    setMaxAttempts(settings.maxInterceptAttempts);
  }

  function buildSettings(): Partial<RoomSettings> {
    return {
      battleMode: isAsync ? "async" : "turn-based",
      attackCooldownMs: cooldownMs,
      interceptWindowMs: interceptMs,
      maxInterceptAttempts: maxAttempts,
    };
  }

  function handleCreate() {
    startTransition(async () => {
      try {
        const roomId = await createRoomAction(buildSettings());
        router.push(`/game/${roomId}`);
      } catch (err) {
        setJoinError(err instanceof Error ? err.message : "Failed to create room");
      }
    });
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!ROOM_CODE_RE.test(code)) {
      setJoinError("Code must be 6 letters or digits");
      return;
    }
    startTransition(async () => {
      const result = await joinRoomAction(code);
      if ("success" in result && result.success) {
        router.push(`/game/${result.roomId}`);
      } else {
        setJoinError("error" in result ? result.error : "Unknown error");
      }
    });
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-6">

      {/* ── Create Room ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className="w-full rounded border border-radar-green px-6 py-3 font-mono text-sm font-bold text-radar-green uppercase tracking-widest transition-colors duration-150 hover:bg-radar-green/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-green radar-glow"
        >
          {showSettings ? "▾ НАСТРОЙКИ КОМНАТЫ" : "▸ СОЗДАТЬ КОМНАТУ"}
        </button>

        {/* ── Settings panel ────────────────────────────────────────────── */}
        {showSettings && (
          <div className="rounded border border-radar-green/25 bg-ocean-900/80 p-4 flex flex-col gap-4">
            <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-radar-green/50 border-b border-ocean-800 pb-2">
              Параметры комнаты
            </p>

            <div className="grid grid-cols-3 gap-1">
              {SETTINGS_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applySettings(preset.settings)}
                  className="rounded border border-ocean-800 px-2 py-1.5 font-mono text-[9px] uppercase tracking-widest text-miss-white/40 transition-colors duration-150 hover:border-radar-green/60 hover:text-radar-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-green"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Battle mode */}
            <CrtToggle
              id="setting-async"
              label="Асинхронный бой"
              value={isAsync}
              onChange={setIsAsync}
            />

            {isAsync && (
              <p className="font-mono text-[9px] leading-relaxed text-miss-white/35 -mt-2">
                Оба игрока атакуют независимо — без ходов. После выстрела игрок ждёт перезарядку.
              </p>
            )}

            {/* Attack cooldown (async only) */}
            <CrtSlider
              id="setting-cooldown"
              label="Перезарядка"
              min={5}
              max={60}
              step={5}
              value={cooldownMs / 1000}
              onChange={(v) => setCooldownMs(v * 1000)}
              format={(v) => `${v}с`}
              disabled={!isAsync}
            />

            {/* Intercept window */}
            <CrtSlider
              id="setting-intercept"
              label="Окно перехвата"
              min={10}
              max={60}
              step={5}
              value={interceptMs / 1000}
              onChange={(v) => setInterceptMs(v * 1000)}
              format={(v) => `${v}с`}
            />

            {/* Max intercept attempts */}
            <CrtSegment
              id="setting-attempts"
              label="Попыток перехвата"
              options={[
                { value: 1, label: "1" },
                { value: 2, label: "2" },
                { value: 3, label: "3" },
                { value: 5, label: "5" },
              ]}
              value={maxAttempts}
              onChange={setMaxAttempts}
            />

            {/* Summary */}
            <div className="rounded border border-ocean-800/60 bg-ocean-950/50 px-3 py-2 font-mono text-[9px] text-miss-white/30 leading-relaxed">
              <span className="text-radar-green/60">Режим: </span>
              {isAsync ? "АСИНХРОННЫЙ" : "ПОШАГОВЫЙ"}
              {isAsync && (
                <>
                  {" · "}
                  <span className="text-morse-amber/60">Перезарядка {cooldownMs / 1000}с</span>
                </>
              )}
              {" · "}
              Перехват {interceptMs / 1000}с / {maxAttempts} поп.
            </div>

            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending}
              className="rounded border border-radar-green px-6 py-2.5 font-mono text-sm font-bold text-radar-green uppercase tracking-widest transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-radar-green enabled:hover:text-ocean-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-green"
            >
              {isPending ? (
                <span style={{ animation: "morse-blink 0.8s step-end infinite" }}>
                  СОЗДАНИЕ...
                </span>
              ) : (
                "[ СОЗДАТЬ ]"
              )}
            </button>
          </div>
        )}

        {!showSettings && (
          <button
            type="button"
            onClick={handleCreate}
            disabled={isPending}
            className="w-full rounded border border-radar-green px-6 py-3 font-mono text-sm font-bold text-radar-green uppercase tracking-widest transition-colors duration-150 disabled:opacity-40 enabled:hover:bg-radar-green enabled:hover:text-ocean-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-green"
            style={{ display: showSettings ? "none" : undefined }}
          >
            {isPending ? "СОЗДАНИЕ..." : "[ СОЗДАТЬ — БЫСТРО ]"}
          </button>
        )}
      </div>

      {/* ── Divider ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 text-miss-white/30">
        <div className="h-px flex-1 bg-current" />
        <span className="font-mono text-xs uppercase">или</span>
        <div className="h-px flex-1 bg-current" />
      </div>

      {/* ── Join Room ─────────────────────────────────────────────────────── */}
      <form onSubmit={handleJoin} className="flex flex-col gap-3">
        <label
          htmlFor="room-code"
          className="font-mono text-xs uppercase tracking-widest text-miss-white/60"
        >
          Код комнаты (6 символов)
        </label>
        <input
          id="room-code"
          name="code"
          type="text"
          placeholder="A7K9P2"
          maxLength={6}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          value={joinCode}
          onChange={(e) => {
            setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6));
            setJoinError("");
          }}
          className="rounded border border-ocean-800 bg-ocean-900 px-4 py-3 font-mono text-lg font-bold tracking-[0.35em] uppercase text-miss-white placeholder-miss-white/20 outline-none transition-colors duration-150 focus:border-radar-dim focus-visible:ring-2 focus-visible:ring-radar-green"
        />
        <button
          type="submit"
          disabled={isPending || joinCode.length !== 6}
          className="rounded border border-morse-amber px-6 py-3 font-mono text-sm font-bold text-morse-amber uppercase tracking-widest transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-morse-amber enabled:hover:text-ocean-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-morse-amber"
        >
          [ ВОЙТИ В КОМНАТУ ]
        </button>

        {joinError && (
          <p role="alert" className="font-mono text-xs text-hit-red uppercase tracking-widest">
            ✕ {joinError}
          </p>
        )}
      </form>
    </div>
  );
}
