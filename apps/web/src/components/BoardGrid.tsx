// apps/web/src/components/BoardGrid.tsx
"use client";

import { type Board, type CellState, COLUMNS, type Coordinate, ROWS } from "@radioboi/game-core";

function cellClass(state: CellState | undefined, isEnemy: boolean, isPlacement: boolean): string {
  const base =
    "relative flex items-center justify-center text-[10px] font-mono " +
    "border border-[var(--color-ocean-800)] transition-colors duration-150 " +
    "cursor-pointer select-none aspect-square";

  if (isPlacement) {
    switch (state) {
      case "ship":
        return `${base} bg-[var(--color-radar-green)]/20 border-[var(--color-radar-green)]/60`;
      default:
        return `${base} bg-[var(--color-ocean-900)] hover:bg-[var(--color-ocean-800)]`;
    }
  }

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
  isPlacement?: boolean;
  onCellClick?: (coord: Coordinate) => void;
};

export function BoardGrid({ board, isEnemy, isPlacement = false, onCellClick }: Props) {
  return (
    <table
      className="border-separate border-spacing-0.5"
      aria-label={isPlacement ? "Расстановка кораблей" : isEnemy ? "Поле противника" : "Ваше поле"}
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
                <td key={coord} className="p-0" data-coord={coord}>
                  <button
                    type="button"
                    data-coord={coord}
                    aria-label={`${col}${rowIndex} — ${state ?? "пусто"}`}
                    className={cellClass(state, isEnemy, isPlacement)}
                    onClick={() => onCellClick?.(coord)}
                    disabled={
                      !isPlacement && !isEnemy
                        ? false
                        : !isPlacement && !isEnemy
                          ? true
                          : !isEnemy && !isPlacement
                            ? false
                            : isEnemy && (state === "hit" || state === "miss" || state === "sunk")
                    }
                  >
                    {cellSymbol(state, isEnemy, isPlacement)}
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