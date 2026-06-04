// apps/web/src/components/BoardGrid.tsx
"use client";

import {
  type Board,
  BOARD_COLUMN_LABELS,
  BOARD_ROW_LABELS,
  type CellState,
  COLUMNS,
  type Coordinate,
  ROWS,
} from "@radioboi/game-core";
import type { ReactNode } from "react";

function cellClass(
  state: CellState | undefined,
  isEnemy: boolean,
  isPlacement: boolean,
  isSelected: boolean,
  isHighlighted: boolean,
): string {
  const base =
    "battle-cell relative flex h-8 w-8 items-center justify-center overflow-hidden text-[11px] font-mono sm:h-9 sm:w-9 lg:h-10 lg:w-10 " +
    "border transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-60";

  if (isSelected && isEnemy) {
    return `${base} battle-cell--selected bg-[var(--color-morse-amber)]/20 border-[var(--color-morse-amber)] text-[var(--color-morse-amber)] ring-1 ring-[var(--color-morse-amber)]/70`;
  }

  if (isPlacement) {
    if (isHighlighted) {
      return `${base} bg-[var(--color-morse-amber)]/20 border-[var(--color-morse-amber)] text-[var(--color-morse-amber)] ring-1 ring-[var(--color-morse-amber)]/60 enabled:cursor-pointer`;
    }
    switch (state) {
      case "ship":
        return `${base} bg-[var(--color-radar-green)]/20 border-[var(--color-radar-green)]/60 text-[var(--color-radar-green)] enabled:cursor-pointer`;
      default:
        return `${base} bg-[var(--color-ocean-900)] border-[var(--color-ocean-700)]/40 enabled:cursor-pointer enabled:hover:bg-[var(--color-ocean-800)]`;
    }
  }

  switch (state) {
    case "ship":
      return isEnemy
        ? `${base} bg-transparent border-[var(--color-ocean-700)]/50 enabled:cursor-crosshair enabled:hover:bg-[var(--color-radar-green)]/10 enabled:hover:border-[var(--color-radar-green)]/45`
        : `${base} battle-cell--ship bg-[var(--color-ocean-800)] border-[var(--color-radar-dim)] text-[var(--color-radar-green)]/75`;
    case "hit":
      return `${base} battle-cell--hit bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.22)_0_8%,transparent_9_18%,rgba(255,59,59,0.34)_19_46%,transparent_47%)] border-[var(--color-hit-red)] text-[var(--color-hit-red)] shadow-[0_0_18px_rgba(255,59,59,0.55)]`;
    case "sunk":
      return `${base} battle-cell--sunk bg-[radial-gradient(circle_at_center,rgba(255,59,59,0.62)_0_28%,rgba(255,170,0,0.28)_29_46%,transparent_47%)] border-[var(--color-hit-red)] text-[var(--color-hit-red)] ring-1 ring-[var(--color-hit-red)]/75 shadow-[0_0_24px_rgba(255,59,59,0.78)]`;
    case "miss":
      return `${base} battle-cell--miss bg-transparent border-[var(--color-miss-white)]/25 text-[var(--color-miss-white)]/55`;
    default:
      return isEnemy
        ? `${base} bg-transparent border-[var(--color-ocean-700)]/50 enabled:cursor-crosshair enabled:hover:bg-[var(--color-radar-green)]/10 enabled:hover:border-[var(--color-radar-green)]/45`
        : `${base} bg-[var(--color-ocean-900)] border-[var(--color-ocean-800)] enabled:cursor-pointer enabled:hover:bg-[var(--color-ocean-800)]`;
  }
}

function cellSymbol(state: CellState | undefined, isEnemy: boolean, isPlacement: boolean): string {
  if (isPlacement && state === "ship") return "\u25aa";
  switch (state) {
    case "hit":
    case "sunk":
      return "\u2715";
    case "miss":
      return "\u00b7";
    case "ship":
      return isEnemy ? "" : "\u25aa";
    default:
      return "";
  }
}

function cellVfx(state: CellState | undefined): ReactNode {
  switch (state) {
    case "hit":
      return (
        <span aria-hidden="true" className="battle-cell-vfx battle-cell-vfx--hit">
          <span className="battle-flame battle-flame--left" />
          <span className="battle-flame battle-flame--mid" />
          <span className="battle-flame battle-flame--right" />
          <span className="battle-smoke battle-smoke--one" />
          <span className="battle-ember battle-ember--one" />
          <span className="battle-ember battle-ember--two" />
        </span>
      );
    case "sunk":
      return (
        <span aria-hidden="true" className="battle-cell-vfx battle-cell-vfx--sunk">
          <span className="battle-flame battle-flame--left" />
          <span className="battle-flame battle-flame--mid" />
          <span className="battle-flame battle-flame--right" />
          <span className="battle-flame battle-flame--deep" />
          <span className="battle-smoke battle-smoke--one" />
          <span className="battle-smoke battle-smoke--two" />
          <span className="battle-ember battle-ember--one" />
          <span className="battle-ember battle-ember--two" />
          <span className="battle-sunk-cross" />
        </span>
      );
    case "miss":
      return (
        <span aria-hidden="true" className="battle-cell-vfx battle-cell-vfx--miss">
          <span className="battle-water-ring battle-water-ring--one" />
          <span className="battle-water-ring battle-water-ring--two" />
          <span className="battle-splash battle-splash--one" />
          <span className="battle-splash battle-splash--two" />
          <span className="battle-splash battle-splash--three" />
        </span>
      );
    default:
      return null;
  }
}

function isCellDisabled(
  state: CellState | undefined,
  isEnemy: boolean,
  isPlacement: boolean,
): boolean {
  if (isPlacement) return false;
  if (!isEnemy) return true;
  return state === "hit" || state === "miss" || state === "sunk";
}

type Props = {
  board: Board;
  isEnemy: boolean;
  isPlacement?: boolean;
  onCellClick?: (coord: Coordinate) => void;
  selectedCoord?: Coordinate | null;
  highlightedCoords?: ReadonlySet<Coordinate> | readonly Coordinate[];
  isInteractive?: boolean;
  disabledMessage?: string | undefined;
};

export function BoardGrid({
  board,
  isEnemy,
  isPlacement = false,
  onCellClick,
  selectedCoord = null,
  highlightedCoords,
  isInteractive = true,
  disabledMessage,
}: Props) {
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
              className="text-center text-[9px] font-mono text-radar-dim leading-tight"
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
              className="w-5 shrink-0 text-center text-[9px] font-mono text-radar-dim"
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
                    {cellVfx(state)}
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
}
