// apps/web/src/components/BoardGrid.tsx
"use client";
// Cell classes are cached and the grid is memoized. Resolved VFX have a small,
// procedural particle budget: hit uses smoke, sunk uses fire, and misses splash.

import {
  type Board,
  BOARD_COLUMN_LABELS,
  BOARD_ROW_LABELS,
  type CellState,
  COLUMNS,
  type Coordinate,
  ROWS,
} from "@radioboi/game-core";
import { memo, useEffect, useState, type CSSProperties, type ReactElement } from "react";

// ── Cell class computation ────────────────────────────────────────────────────

// PERF-1: Cache is keyed by a compact string representing all inputs that affect class.
// With 100 cells and ~8 states, the cache reaches steady state quickly and never
// re-computes string concatenation on subsequent renders.
const _cellClassCache = new Map<string, string>();

function cellClass(
  state: CellState | undefined,
  isEnemy: boolean,
  isPlacement: boolean,
  isSelected: boolean,
  isHighlighted: boolean,
): string {
  // Build a compact cache key
  const key = `${state ?? "_"}|${isEnemy ? 1 : 0}|${isPlacement ? 1 : 0}|${isSelected ? 1 : 0}|${isHighlighted ? 1 : 0}`;
  const cached = _cellClassCache.get(key);
  if (cached !== undefined) return cached;

  const base =
    "battle-cell relative flex h-8 w-8 items-center justify-center overflow-hidden text-[11px] font-mono sm:h-9 sm:w-9 lg:h-10 lg:w-10 " +
    "border transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-60";

  let result: string;

  if (isSelected && isEnemy) {
    result = `${base} battle-cell--selected bg-[var(--color-morse-amber)]/20 border-[var(--color-morse-amber)] text-[var(--color-morse-amber)] ring-1 ring-[var(--color-morse-amber)]/70`;
  } else if (isPlacement) {
    if (isHighlighted) {
      result = `${base} bg-[var(--color-morse-amber)]/20 border-[var(--color-morse-amber)] text-[var(--color-morse-amber)] ring-1 ring-[var(--color-morse-amber)]/60 enabled:cursor-pointer`;
    } else if (state === "ship") {
      result = `${base} bg-[var(--color-radar-green)]/20 border-[var(--color-radar-green)]/60 text-[var(--color-radar-green)] enabled:cursor-pointer`;
    } else {
      result = `${base} bg-[var(--color-ocean-900)] border-[var(--color-ocean-700)]/40 enabled:cursor-pointer enabled:hover:bg-[var(--color-ocean-800)]`;
    }
  } else {
    switch (state) {
      case "ship":
        result = isEnemy
          ? `${base} bg-transparent border-[var(--color-ocean-700)]/50 enabled:cursor-crosshair enabled:hover:bg-[var(--color-radar-green)]/10 enabled:hover:border-[var(--color-radar-green)]/45`
          : `${base} battle-cell--ship bg-[var(--color-ocean-800)] border-[var(--color-radar-dim)] text-[var(--color-radar-green)]/75`;
        break;
      case "hit":
        result = `${base} battle-cell--hit bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.22)_0_8%,transparent_9_18%,rgba(255,59,59,0.34)_19_46%,transparent_47%)] border-[var(--color-hit-red)] text-[var(--color-hit-red)]`;
        break;
      case "sunk":
        result = `${base} battle-cell--sunk bg-[radial-gradient(circle_at_center,rgba(255,59,59,0.62)_0_28%,rgba(255,170,0,0.28)_29_46%,transparent_47%)] border-[var(--color-hit-red)] text-[var(--color-hit-red)] ring-1 ring-[var(--color-hit-red)]/75`;
        break;
      case "miss":
        result = `${base} battle-cell--miss bg-transparent border-[var(--color-miss-white)]/25 text-[var(--color-miss-white)]/55`;
        break;
      case "blocked":
        result = `${base} battle-cell--blocked bg-transparent border-[var(--color-miss-white)]/15 text-[var(--color-miss-white)]/35`;
        break;
      default:
        result = isEnemy
          ? `${base} bg-transparent border-[var(--color-ocean-700)]/50 enabled:cursor-crosshair enabled:hover:bg-[var(--color-radar-green)]/10 enabled:hover:border-[var(--color-radar-green)]/45`
          : `${base} bg-[var(--color-ocean-900)] border-[var(--color-ocean-800)] enabled:cursor-pointer enabled:hover:bg-[var(--color-ocean-800)]`;
    }
  }

  _cellClassCache.set(key, result);
  return result;
}

// ── Cell symbol ───────────────────────────────────────────────────────────────

function cellSymbol(state: CellState | undefined, isEnemy: boolean, isPlacement: boolean): string {
  if (isPlacement && state === "ship") return "\u25aa";
  switch (state) {
    case "hit":
    case "sunk":
      return "\u2715";
    case "miss":
    case "blocked":
      return "\u00b7";
    case "ship":
      return isEnemy ? "" : "\u25aa";
    default:
      return "";
  }
}

// Procedural VFX
// Effects use fewer layers than the former fixed templates and receive fresh
// Web Crypto entropy after each page load. Their shape, phase, and timing are
// therefore unique for every board/session without animating layout properties.

type VfxStyle = CSSProperties & Record<`--${string}`, string>;
type ParticleKind = "bubble" | "cross" | "ember" | "flame" | "ring" | "smoke" | "splash";
const PARTICLE_KEYS = ["alpha", "bravo", "charlie", "delta"] as const;

function mixSeed(seed: number): number {
  let value = seed | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return value ^ (value >>> 16);
}

function proceduralUnit(seed: number, salt: number): number {
  return (mixSeed(seed + salt) >>> 0) / 0x1_0000_0000;
}

function createVfxSessionSeed(): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const entropy = new Uint32Array(1);
    crypto.getRandomValues(entropy);
    return entropy[0] ?? 0;
  }
  return (Date.now() ^ (Math.random() * 0x1_0000_0000)) >>> 0;
}

function useVfxSessionSeed(): number {
  // Keep SSR and the initial hydration render identical, then introduce a new
  // session seed before an animation becomes perceptible.
  const [seed, setSeed] = useState(0);
  useEffect(() => {
    setSeed(createVfxSessionSeed());
  }, []);
  return seed;
}

function effectSeed(sessionSeed: number, coord: Coordinate, state: CellState): number {
  let seed = sessionSeed ^ state.length;
  for (let index = 0; index < coord.length; index++) {
    seed = mixSeed(seed ^ coord.charCodeAt(index));
  }
  return seed;
}

function seconds(value: number): string {
  return `${value.toFixed(2)}s`;
}

function particleStyle(kind: ParticleKind, seed: number, index: number): VfxStyle {
  const random = (salt: number) => proceduralUnit(seed, index * 97 + salt);
  const duration = 0.72 + random(2) * 1.45;
  const timing = {
    "--vfx-delay": seconds(random(1) * 0.22),
    "--vfx-duration": seconds(duration),
  };

  switch (kind) {
    case "flame":
      return {
        ...timing,
        "--vfx-bottom": `${12 + random(3) * 13}%`,
        "--vfx-height": `${42 + random(4) * 35}%`,
        "--vfx-left": `${31 + random(5) * 38}%`,
        "--vfx-width": `${23 + random(6) * 24}%`,
      };
    case "smoke":
      return {
        ...timing,
        // A negative delay starts each persistent cloud at a different point
        // in its loop, so a hit is never an empty, synchronized plume.
        "--vfx-delay": seconds(-random(1) * duration),
        "--smoke-drift": `${Math.round(-15 + random(7) * 30)}px`,
        "--vfx-bottom": `${6 + random(8) * 12}%`,
        "--vfx-height": `${42 + random(9) * 26}%`,
        "--vfx-left": `${22 + random(10) * 56}%`,
        "--vfx-width": `${45 + random(11) * 28}%`,
      };
    case "ember":
      return {
        ...timing,
        "--ember-x": `${Math.round(-12 + random(12) * 24)}px`,
        "--vfx-bottom": `${27 + random(13) * 23}%`,
        "--vfx-height": `${2 + random(14) * 3}px`,
        "--vfx-left": `${31 + random(15) * 40}%`,
        "--vfx-width": `${2 + random(16) * 3}px`,
      };
    case "ring":
      return {
        ...timing,
        "--vfx-height": `${34 + random(17) * 24}%`,
        "--vfx-left": `${42 + random(18) * 16}%`,
        "--vfx-top": `${43 + random(19) * 14}%`,
        "--vfx-width": `${65 + random(20) * 26}%`,
      };
    case "splash":
      return {
        ...timing,
        "--splash-x": `${Math.round(-12 + random(21) * 24)}px`,
        "--vfx-bottom": `${31 + random(22) * 19}%`,
        "--vfx-height": `${10 + random(23) * 12}px`,
        "--vfx-left": `${32 + random(24) * 36}%`,
        "--vfx-width": `${3 + random(25) * 4}px`,
      };
    case "bubble":
      return {
        ...timing,
        "--bubble-x": `${Math.round(-12 + random(26) * 24)}px`,
        "--vfx-bottom": `${12 + random(27) * 20}%`,
        "--vfx-height": `${4 + random(28) * 5}px`,
        "--vfx-left": `${33 + random(29) * 34}%`,
        "--vfx-width": `${4 + random(30) * 5}px`,
      };
    case "cross":
      return {
        ...timing,
        "--vfx-height": `${62 + random(31) * 14}%`,
        "--vfx-left": "50%",
        "--vfx-top": "50%",
        "--vfx-width": `${62 + random(32) * 14}%`,
      };
  }
}

function particles(kind: ParticleKind, count: number, seed: number): ReactElement[] {
  return PARTICLE_KEYS.slice(0, count).map((particleKey, index) => (
    <span
      key={`${kind}-${seed}-${particleKey}`}
      className={`battle-${kind === "ring" ? "water-ring" : kind}`}
      style={particleStyle(kind, seed, index)}
    />
  ));
}

type CellVfxProps = {
  state: CellState | undefined;
  coord: Coordinate;
  sessionSeed: number;
  impactStartsAt?: number | undefined;
};

function CellVfx({ state, coord, sessionSeed, impactStartsAt }: CellVfxProps) {
  const [isVisible, setIsVisible] = useState(
    () => impactStartsAt === undefined || impactStartsAt <= Date.now(),
  );

  useEffect(() => {
    const delayMs = impactStartsAt === undefined ? 0 : impactStartsAt - Date.now();
    if (delayMs <= 0) {
      setIsVisible(true);
      return;
    }

    setIsVisible(false);
    const timer = setTimeout(() => setIsVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [impactStartsAt]);

  if (!isVisible) return null;
  if (state === "blocked") {
    return <span aria-hidden="true" className="battle-cell-vfx battle-cell-vfx--blocked" />;
  }
  if (state !== "hit" && state !== "miss" && state !== "sunk") return null;

  const seed = effectSeed(sessionSeed, coord, state);
  if (state === "hit") {
    return (
      <span aria-hidden="true" className="battle-cell-vfx battle-cell-vfx--hit">
        {particles("flame", 2, seed + 53)}
        {particles("smoke", 4, seed)}
      </span>
    );
  }
  if (state === "sunk") {
    return (
      <span aria-hidden="true" className="battle-cell-vfx battle-cell-vfx--sunk">
        {particles("flame", 3, seed)}
        {particles("smoke", 2, seed + 101)}
        {particles("ember", 2, seed + 211)}
        <span className="battle-sunk-cross" style={particleStyle("cross", seed + 307, 0)} />
      </span>
    );
  }

  return (
    <span aria-hidden="true" className="battle-cell-vfx battle-cell-vfx--miss">
      {particles("ring", 1, seed)}
      {particles("splash", 2, seed + 101)}
      {particles("bubble", 1, seed + 211)}
    </span>
  );
}

// ── Disabled state ────────────────────────────────────────────────────────────

function isCellDisabled(
  state: CellState | undefined,
  isEnemy: boolean,
  isPlacement: boolean,
): boolean {
  if (isPlacement) return false;
  if (!isEnemy) return true;
  return state === "hit" || state === "miss" || state === "sunk" || state === "blocked";
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  board: Board;
  isEnemy: boolean;
  isPlacement?: boolean;
  onCellClick?: (coord: Coordinate) => void;
  selectedCoord?: Coordinate | null;
  highlightedCoords?: ReadonlySet<Coordinate> | readonly Coordinate[];
  isInteractive?: boolean;
  disabledMessage?: string | undefined;
  impactVfxStartsAt?: Readonly<Record<string, number>> | undefined;
};

// ── Component ─────────────────────────────────────────────────────────────────

// PERF-4: React.memo prevents re-render when parent state changes but board/selection
// have not changed. This is critical — GameClientWrapper re-renders every 250ms
// for countdowns, and without memo the entire 100-cell grid re-renders each tick.
export const BoardGrid = memo(function BoardGrid({
  board,
  isEnemy,
  isPlacement = false,
  onCellClick,
  selectedCoord = null,
  highlightedCoords,
  isInteractive = true,
  disabledMessage,
  impactVfxStartsAt,
}: Props) {
  const vfxSessionSeed = useVfxSessionSeed();
  const highlightedSet =
    highlightedCoords instanceof Set
      ? highlightedCoords
      : new Set(highlightedCoords ?? []);

  return (
    <table
      className="border-separate border-spacing-0.5"
      aria-label={isPlacement ? "Расстановка кораблей" : isEnemy ? "Поле противника" : "Ваше поле"}
    >
      <thead>
        <tr>
          <th className="w-5" />
          {COLUMNS.map((col, colIndex) => (
            <th
              key={col}
              scope="col"
              className="text-center text-[13px] font-mono text-radar-dim leading-tight"
            >
              {BOARD_COLUMN_LABELS[colIndex] ?? col}
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {ROWS.map((row, rowIndex) => (
          <tr key={row}>
            <th
              scope="row"
              className="w-5 shrink-0 text-center text-[13px] font-mono text-radar-dim"
            >
              {BOARD_ROW_LABELS[rowIndex] ?? rowIndex}
            </th>

            {COLUMNS.map((col, colIndex) => {
              const coord = (col + row) as Coordinate;
              const state = board[coord];
              const isSelected = selectedCoord === coord;
              const isHighlighted = highlightedSet.has(coord);
              const rowLabel = BOARD_ROW_LABELS[rowIndex] ?? String(rowIndex);
              const colLabel = BOARD_COLUMN_LABELS[colIndex] ?? col;
              const isDisabled =
                !isInteractive || isCellDisabled(state, isEnemy, isPlacement);

              return (
                <td key={coord} className="p-0" data-coord={coord}>
                  <button
                    type="button"
                    data-coord={coord}
                    aria-label={`${rowLabel}${colLabel}${isSelected ? " (selected target)" : ""} — ${state ?? "empty"}${!isInteractive && disabledMessage ? `. ${disabledMessage}` : ""}`}
                    aria-pressed={isSelected}
                    className={cellClass(state, isEnemy, isPlacement, isSelected, isHighlighted)}
                    onClick={() => onCellClick?.(coord)}
                    disabled={isDisabled}
                    title={!isInteractive ? disabledMessage : undefined}
                  >
                    <CellVfx
                      state={state}
                      coord={coord}
                      sessionSeed={vfxSessionSeed}
                      impactStartsAt={impactVfxStartsAt?.[`${isEnemy ? "enemy" : "own"}:${coord}`]}
                    />
                    <span className="relative z-10 drop-shadow-[0_0_8px_currentColor]">
                      {isSelected ? "\u2295" : cellSymbol(state, isEnemy, isPlacement)}
                    </span>
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
});
