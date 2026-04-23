// apps/web/src/components/BoardGrid.tsx
"use client";

import { type Board, type CellState, COLUMNS, type Coordinate, ROWS } from "@radioboi/game-core";

function cellClass(state: CellState | undefined, isEnemy: boolean): string {
  const base =
    "relative flex items-center justify-center text-[10px] font-mono " +
    "border border-[var(--color-ocean-800)] transition-colors duration-150 " +
    "cursor-pointer select-none aspect-square";

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

function cellSymbol(state: CellState | undefined, isEnemy: boolean): string {
  switch (state) {
    case "hit":
      return "✕";
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

type Props = {
  board: Board;
  isEnemy: boolean;
  onCellClick?: (coord: Coordinate) => void;
};

export function BoardGrid({ board, isEnemy, onCellClick }: Props) {
  return (
    <table
      className="border-separate border-spacing-0.5"
      aria-label={isEnemy ? "Поле противника" : "Ваше поле"}
    >
      {/* Заголовок столбцов */}
      <thead>
        <tr>
          {/* Corner spacer */}
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
            {/* Метка строки */}
            <th
              scope="row"
              className="w-5 shrink-0 text-center text-[9px] font-mono text-radar-dim"
            >
              {rowIndex}
            </th>

            {/* Ячейки */}
            {COLUMNS.map((col) => {
              const coord = (col + row) as Coordinate;
              const state = board[coord];

              return (
                <td key={coord} className="p-0">
                  <button
                    type="button" // ← fixes useButtonType
                    aria-label={`${col}${rowIndex} — ${state ?? "пусто"}`}
                    className={cellClass(state, isEnemy)}
                    onClick={() => onCellClick?.(coord)}
                    disabled={!isEnemy || state === "hit" || state === "miss" || state === "sunk"}
                  >
                    {cellSymbol(state, isEnemy)}
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
