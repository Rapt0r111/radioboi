// apps/web/src/components/BoardGrid.tsx
"use client";

import { type Board, type CellState, COLUMNS, type Coordinate, ROWS } from "@radioboi/game-core";

// ── Helpers ───────────────────────────────────────────────────────────────────

function cellClass(
  state: CellState | undefined,
  isEnemy: boolean,
  isPlacement: boolean,
  isSelected: boolean,
  isHighlighted: boolean,
): string {
  const base =
    "relative flex h-8 w-8 items-center justify-center text-[11px] font-mono sm:h-9 sm:w-9 lg:h-10 lg:w-10 " +
    "border transition-colors duration-150 " +
    "select-none disabled:cursor-not-allowed disabled:opacity-55";

  // ── Selected enemy target ─────────────────────────────────────────────
  if (isSelected && isEnemy) {
    return `${base} bg-[var(--color-morse-amber)]/20 border-[var(--color-morse-amber)] text-[var(--color-morse-amber)] ring-1 ring-[var(--color-morse-amber)]/60`;
  }

  // ── Placement mode ────────────────────────────────────────────────────
  if (isPlacement) {
    if (isHighlighted) {
      return `${base} bg-[var(--color-morse-amber)]/20 border-[var(--color-morse-amber)] text-[var(--color-morse-amber)] ring-1 ring-[var(--color-morse-amber)]/60 enabled:cursor-pointer`;
    }
    switch (state) {
      case "ship":
        return `${base} bg-[var(--color-radar-green)]/20 border-[var(--color-radar-green)]/60 enabled:cursor-pointer`;
      default:
        return `${base} bg-[var(--color-ocean-900)] border-[var(--color-ocean-700)]/40 enabled:cursor-pointer enabled:hover:bg-[var(--color-ocean-800)]`;
    }
  }

  // ── Battle / own board ────────────────────────────────────────────────
  switch (state) {
    case "ship":
    return isEnemy
        // Вражеский корабль: не виден игроку, но ячейка должна быть кликабельной
        // Видимая граница + зелёный hover чётко показывают зону прицела
        ? `${base} bg-transparent border-[var(--color-ocean-700)]/50 enabled:cursor-crosshair enabled:hover:bg-[var(--color-radar-green)]/10`
        : `${base} bg-[var(--color-ocean-800)] border-[var(--color-radar-dim)]`;
    case "hit":
      return `${base} bg-[var(--color-hit-red)]/20 border-[var(--color-hit-red)] text-[var(--color-hit-red)]`;
    case "sunk":
      return `${base} bg-[var(--color-hit-red)]/40 border-[var(--color-hit-red)] text-[var(--color-hit-red)]`;
    case "miss":
      return `${base} bg-transparent border-[var(--color-miss-white)]/20 text-[var(--color-miss-white)]/40`;
    default:
      // Пустые ячейки врага: прозрачный фон, видимая граница, зелёный hover
      // ИСПРАВЛЕНИЕ: было bg-ocean-900 с ocean-800 бордером — почти невидимо.
      // Теперь прозрачный фон + контрастная граница + cursor-crosshair.
      return isEnemy
        ? `${base} bg-transparent border-[var(--color-ocean-700)]/50 enabled:cursor-crosshair enabled:hover:bg-[var(--color-radar-green)]/10`
        : `${base} bg-[var(--color-ocean-900)] border-[var(--color-ocean-800)] enabled:cursor-pointer enabled:hover:bg-[var(--color-ocean-800)]`;
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
   * Highlights the selected enemy target in amber.
   */
  selectedCoord?: Coordinate | null;
  highlightedCoords?: ReadonlySet<Coordinate> | readonly Coordinate[];
  /**
   * Disables the whole board without changing already-known cell states.
   */
  isInteractive?: boolean;
  disabledMessage?: string | undefined;
};

// ── Component ──────────────────────────────────────────────────────────────────

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
              const isHighlighted = highlightedSet.has(coord);
              const isDisabled =
                !isInteractive || isCellDisabled(state, isEnemy, isPlacement);

              return (
                <td key={coord} className="p-0" data-coord={coord}>
                  <button
                    type="button"
                    data-coord={coord}
                    aria-label={`${col}${rowIndex}${isSelected ? " (цель)" : ""} — ${state ?? "пусто"}${!isInteractive && disabledMessage ? `. ${disabledMessage}` : ""}`}
                    aria-pressed={isSelected}
                    className={cellClass(state, isEnemy, isPlacement, isSelected, isHighlighted)}
                    onClick={() => onCellClick?.(coord)}
                    disabled={isDisabled}
                    title={!isInteractive ? disabledMessage : undefined}
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
