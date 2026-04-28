// apps/web/src/components/BoardGrid.tsx
// FIXED: added selectedCoord prop — highlights the chosen enemy target cell in amber.
"use client";

import { type Board, type CellState, COLUMNS, type Coordinate, ROWS } from "@radioboi/game-core";

// ── Helpers ───────────────────────────────────────────────────────────────────

function cellClass(
  state: CellState | undefined,
  isEnemy: boolean,
  isPlacement: boolean,
  isSelected: boolean,
): string {
  const base =
    "relative flex items-center justify-center text-[10px] font-mono " +
    "border border-[var(--color-ocean-800)] transition-colors duration-150 " +
    "cursor-pointer select-none aspect-square";

  // ── Selected enemy target ─────────────────────────────────────────────────
  if (isSelected && isEnemy) {
    return `${base} bg-[var(--color-morse-amber)]/20 border-[var(--color-morse-amber)] text-[var(--color-morse-amber)] ring-1 ring-[var(--color-morse-amber)]/60`;
  }

  // ── Placement mode ────────────────────────────────────────────────────────
  if (isPlacement) {
    switch (state) {
      case "ship":
        return `${base} bg-[var(--color-radar-green)]/20 border-[var(--color-radar-green)]/60`;
      default:
        return `${base} bg-[var(--color-ocean-900)] hover:bg-[var(--color-ocean-800)]`;
    }
  }

  // ── Battle / own board ────────────────────────────────────────────────────
  switch (state) {
    case "ship":
      return isEnemy
        ? `${base} bg-[var(--color-ocean-900)] hover:bg-[var(--color-ocean-800)]`
        : `${base} bg-[var(--color-ocean-800)] border-[var(--color-radar-dim)]`;
    case "hit":
      return `${base} bg-[var(--color-hit-red)]/20 border-[var(--color-hit-red)] text-[var(--color-hit-red)]`;
    case "sunk":
      return `${base} bg-[var(--color-hit-red)]/40 border-[var(--color-hit-red)] text-[var(--color-hit-red)]`;
    case "miss":
      return `${base} bg-transparent border-[var(--color-miss-white)]/20 text-[var(--color-miss-white)]/40`;
    default:
      return `${base} bg-[var(--color-ocean-900)] hover:bg-[var(--color-ocean-800)]`;
  }
}

function cellSymbol(state: CellState | undefined, isEnemy: boolean, isPlacement: boolean): string {
  if (isPlacement && state === "ship") return "▪";
  switch (state) {
    case "hit":
    case "sunk":
      return "✕";
    case "miss":
      return "·";
    case "ship":
      return isEnemy ? "" : "▪";
    default:
      return "";
  }
}

/**
 * Disabled logic:
 * - Placement mode  → always enabled (let the placement handler decide)
 * - Own board       → always disabled (can't click own cells during battle)
 * - Enemy board     → disabled only for already-shot cells
 */
function isCellDisabled(
  state: CellState | undefined,
  isEnemy: boolean,
  isPlacement: boolean,
): boolean {
  if (isPlacement) return false;
  if (!isEnemy) return true;
  return state === "hit" || state === "miss" || state === "sunk";
}

// ── Props ──────────────────────────────────────────────────────────────────────

type Props = {
  board: Board;
  isEnemy: boolean;
  isPlacement?: boolean;
  onCellClick?: (coord: Coordinate) => void;
  /**
   * FIX: Highlights the selected enemy target in amber.
   * Pass selectedTarget from GameClientWrapper to give the player
   * clear visual feedback of which cell they're about to fire at.
   */
  selectedCoord?: Coordinate | null;
};

// ── Component ──────────────────────────────────────────────────────────────────

export function BoardGrid({
  board,
  isEnemy,
  isPlacement = false,
  onCellClick,
  selectedCoord = null,
}: Props) {
  return (
    <table
      className="border-separate border-spacing-0.5"
      aria-label={isPlacement ? "Расстановка кораблей" : isEnemy ? "Поле противника" : "Ваше поле"}
    >
      {/* Заголовок столбцов */}
      <thead>
        <tr>
          <th className="w-5" />
          {COLUMNS.map((col) => (
            <th
              key={col}
              scope="col"
              className="text-center text-[9px] font-mono text-radar-dim leading-tight"
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>

      {/* Строки поля */}
      <tbody>
        {ROWS.map((row, rowIndex) => (
          <tr key={row}>
            <th
              scope="row"
              className="w-5 shrink-0 text-center text-[9px] font-mono text-radar-dim"
            >
              {rowIndex}
            </th>

            {COLUMNS.map((col) => {
              const coord = (col + row) as Coordinate;
              const state = board[coord];
              const isSelected = selectedCoord === coord;

              return (
                <td key={coord} className="p-0" data-coord={coord}>
                  <button
                    type="button"
                    data-coord={coord}
                    aria-label={`${col}${rowIndex}${isSelected ? " (цель)" : ""} — ${state ?? "пусто"}`}
                    aria-pressed={isSelected}
                    className={cellClass(state, isEnemy, isPlacement, isSelected)}
                    onClick={() => onCellClick?.(coord)}
                    disabled={isCellDisabled(state, isEnemy, isPlacement)}
                  >
                    {isSelected ? "⊕" : cellSymbol(state, isEnemy, isPlacement)}
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