"use client";

// apps/web/src/components/LobbyCreateForm.tsx
// Interactive room creation/join form with radio-room settings.

import type { RoomSettings } from "@radioboi/game-core";
import { DEFAULT_ROOM_SETTINGS } from "@radioboi/game-core";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { createRoomAction, joinRoomAction } from "../../app/actions";

const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;
const ROOM_SETTINGS_KEY_PREFIX = "radioboi:settings:";

type Props = {
  initialError?: string;
};

type ToggleProps = {
  id: string;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
};

type SliderProps = {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  disabled?: boolean;
};

type SegmentProps = {
  id: string;
  label: string;
  options: { value: number; label: string }[];
  value: number;
  onChange: (value: number) => void;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const SETTINGS_PRESETS: Array<{ id: string; label: string; hint: string; settings: RoomSettings }> = [
  {
    id: "classic",
    label: "CLASSIC",
    hint: "стандартный перехват",
    settings: DEFAULT_ROOM_SETTINGS,
  },
  {
    id: "rapid",
    label: "RAPID",
    hint: "быстро и жёстко",
    settings: {
      battleMode: "turn-based",
      attackCooldownMs: 2_000,
      interceptWindowMs: 15_000,
      maxInterceptAttempts: 2,
    },
  },
  {
    id: "async",
    label: "ASYNC",
    hint: "огонь без ходов",
    settings: {
      battleMode: "async",
      attackCooldownMs: 2_000,
      interceptWindowMs: 25_000,
      maxInterceptAttempts: 3,
    },
  },
];

function CrtToggle({ id, label, value, onChange }: ToggleProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded border border-ocean-800/70 bg-ocean-950/45 px-3 py-2">
      <label htmlFor={id} className="font-mono text-xs uppercase tracking-[0.18em] text-miss-white/62">
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
            "absolute left-0.5 top-0.5 h-5 w-5 rounded-full transition-transform duration-200",
            value ? "translate-x-6 bg-radar-green" : "translate-x-0 bg-ocean-700",
          )}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

function CrtSlider({ id, label, min, max, step, value, onChange, format, disabled }: SliderProps) {
  return (
    <div className={cx("flex flex-col gap-1.5", disabled && "pointer-events-none opacity-35")}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="font-mono text-xs uppercase tracking-[0.18em] text-miss-white/58">
          {label}
        </label>
        <span className="font-mono text-xs tabular-nums text-radar-green">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        disabled={disabled}
        className="h-2 w-full cursor-pointer accent-radar-green"
      />
    </div>
  );
}

function CrtSegment({ id, label, options, value, onChange }: SegmentProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-mono text-xs uppercase tracking-[0.18em] text-miss-white/58">{label}</legend>
      <div id={id} className="grid grid-cols-4 gap-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cx(
              "rounded border px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-green",
              value === option.value
                ? "border-radar-green bg-radar-green/15 text-radar-green"
                : "border-ocean-800 text-miss-white/42 hover:border-ocean-700 hover:text-miss-white/70",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function LobbyCreateForm({ initialError }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showSettings, setShowSettings] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState(initialError ?? "");
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

  function handleCreate(): void {
    startTransition(async () => {
      try {
        const settings = buildSettings();
        const roomId = await createRoomAction(settings);
        try {
          sessionStorage.setItem(`${ROOM_SETTINGS_KEY_PREFIX}${roomId}`, JSON.stringify(settings));
        } catch {
          // Storage is optional; the server still has the room settings.
        }
        router.push(`/game/${roomId}`);
      } catch (error) {
        setJoinError(error instanceof Error ? error.message : "Не удалось создать комнату");
      }
    });
  }

  function handleJoin(event: FormEvent): void {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!ROOM_CODE_RE.test(code)) {
      setJoinError("Код должен состоять из 6 букв или цифр");
      return;
    }
    startTransition(async () => {
      const result = await joinRoomAction(code);
      if ("success" in result && result.success) {
        router.push(`/game/${result.roomId}`);
      } else {
        setJoinError("error" in result ? result.error : "Не удалось войти в комнату");
      }
    });
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <section className="rounded border border-radar-green/20 bg-ocean-900/36 p-3 shadow-[0_0_22px_rgba(0,255,136,0.04)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-radar-green/55">канал создания</p>
            <h3 className="mt-1 font-mono text-sm font-bold uppercase tracking-[0.2em] text-radar-green">Новая комната</h3>
          </div>
          <span className="rounded border border-radar-green/20 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-radar-green/60">
            armed
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setShowSettings((value) => !value)}
            className="w-full rounded border border-radar-green/80 px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-radar-green transition-colors duration-150 hover:bg-radar-green/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-green radar-glow"
          >
            {showSettings ? "▾ настройки комнаты" : "▸ создать комнату"}
          </button>

          {showSettings ? (
            <div className="flex flex-col gap-4 rounded border border-ocean-800/80 bg-ocean-950/58 p-4">
              <div className="grid grid-cols-3 gap-1.5">
                {SETTINGS_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applySettings(preset.settings)}
                    className="rounded border border-ocean-800 bg-ocean-900/45 px-2 py-2 text-left transition-colors duration-150 hover:border-radar-green/60 hover:bg-radar-green/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-green"
                  >
                    <span className="block font-mono text-[10px] font-bold uppercase tracking-widest text-radar-green/85">{preset.label}</span>
                    <span className="mt-1 block text-[9px] leading-4 text-miss-white/36">{preset.hint}</span>
                  </button>
                ))}
              </div>

              <CrtToggle id="setting-async" label="Асинхронный бой" value={isAsync} onChange={setIsAsync} />

              {isAsync ? (
                <p className="rounded border border-morse-amber/20 bg-morse-amber/5 px-3 py-2 font-mono text-[10px] leading-5 text-morse-amber/62">
                  Оба игрока атакуют независимо. Перехват отключён, после пуска работает только перезарядка.
                </p>
              ) : null}

              <CrtSlider
                id="setting-cooldown"
                label="Перезарядка"
                min={2}
                max={60}
                step={1}
                value={cooldownMs / 1000}
                onChange={(value) => setCooldownMs(value * 1000)}
                format={(value) => `${value}с`}
                disabled={!isAsync}
              />

              {!isAsync ? (
                <>
                  <CrtSlider
                    id="setting-intercept"
                    label="Окно перехвата"
                    min={10}
                    max={60}
                    step={5}
                    value={interceptMs / 1000}
                    onChange={(value) => setInterceptMs(value * 1000)}
                    format={(value) => `${value}с`}
                  />

                  <CrtSegment
                    id="setting-attempts"
                    label="Попытки перехвата"
                    options={[
                      { value: 1, label: "1" },
                      { value: 2, label: "2" },
                      { value: 3, label: "3" },
                      { value: 5, label: "5" },
                    ]}
                    value={maxAttempts}
                    onChange={setMaxAttempts}
                  />
                </>
              ) : (
                <div className="rounded border border-hit-red/25 bg-hit-red/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-hit-red/60">
                  Перехват отключён: результат считается после валидного пуска ракеты.
                </div>
              )}

              <div className="rounded border border-ocean-800/70 bg-ocean-950/60 px-3 py-2 font-mono text-[10px] leading-5 text-miss-white/38">
                <span className="text-radar-green/70">Режим: </span>
                {isAsync ? "АСИНХРОННЫЙ" : "ПОШАГОВЫЙ"}
                {isAsync
                  ? ` · перезарядка ${cooldownMs / 1000}с · перехват отключён`
                  : ` · перехват ${interceptMs / 1000}с · ${maxAttempts} поп.`}
              </div>

              <button
                type="button"
                onClick={handleCreate}
                disabled={isPending}
                className="rounded border border-radar-green px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-radar-green transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-radar-green enabled:hover:text-ocean-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-green"
              >
                {isPending ? "создание..." : "[ создать ]"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending}
              className="w-full rounded border border-radar-green/80 bg-radar-green/10 px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-radar-green transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-radar-green enabled:hover:text-ocean-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-green"
            >
              {isPending ? "создание..." : "[ быстрый старт ]"}
            </button>
          )}
        </div>
      </section>

      <div className="flex items-center gap-3 text-miss-white/25">
        <div className="h-px flex-1 bg-current" />
        <span className="font-mono text-xs uppercase tracking-[0.2em]">или</span>
        <div className="h-px flex-1 bg-current" />
      </div>

      <form onSubmit={handleJoin} className="rounded border border-morse-amber/25 bg-ocean-900/32 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-morse-amber/55">канал входа</p>
            <h3 className="mt-1 font-mono text-sm font-bold uppercase tracking-[0.2em] text-morse-amber">Подключиться</h3>
          </div>
          <span className="rounded border border-morse-amber/20 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-morse-amber/60">
            join
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <label htmlFor="room-code" className="font-mono text-xs uppercase tracking-[0.18em] text-miss-white/58">
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
            onChange={(event) => {
              setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6));
              setJoinError("");
            }}
            className="rounded border border-ocean-800 bg-ocean-950/80 px-4 py-3 font-mono text-lg font-bold uppercase tracking-[0.35em] text-miss-white outline-none transition-colors duration-150 placeholder:text-miss-white/20 focus:border-morse-amber focus-visible:ring-2 focus-visible:ring-morse-amber"
          />
          <button
            type="submit"
            disabled={isPending || joinCode.length !== 6}
            className="rounded border border-morse-amber px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-morse-amber transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-morse-amber enabled:hover:text-ocean-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-morse-amber"
          >
            [ войти в комнату ]
          </button>

          {joinError ? (
            <p role="alert" className="font-mono text-xs uppercase tracking-[0.14em] text-hit-red">
              ✕ {joinError}
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
