// apps/web/src/components/BoardGrid.tsx
// Игровое поле 10×10. Работает с React Compiler — никакой ручной мемоизации.
"use client";

import { COLUMNS, ROWS, type Board, type CellState, type Coordinate } from "@radioboi/game-core";

// ── Утилиты стилей ────────────────────────────────────────────────────────────

function cellClass(state: CellState | undefined, isEnemy: boolean): string {
  const base =
    "relative flex items-center justify-center text-[10px] font-mono " +
    "border border-[var(--color-ocean-800)] transition-colors duration-150 " +
    "cursor-pointer select-none aspect-square";

  switch (state) {
    case "ship":
      // Показываем корабли только на своём поле
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

// ── Компонент ─────────────────────────────────────────────────────────────────

type Props = {
  board: Board;
  isEnemy: boolean;
  onCellClick?: (coord: Coordinate) => void;
};

export function BoardGrid({ board, isEnemy, onCellClick }: Props) {
  return (
    <div className="flex flex-col gap-0.5" role="grid" aria-label={isEnemy ? "Поле противника" : "Ваше поле"}>
      {/* Заголовок столбцов */}
      <div className="flex gap-0.5 pl-6">
        {COLUMNS.map((col) => (
          <div
            key={col}
            className="flex-1 text-center text-[9px] font-mono text-radar-dim leading-tight"
          >
            {col}
          </div>
        ))}
      </div>

      {/* Строки поля */}
      {ROWS.map((row, rowIndex) => (
        <div key={row} className="flex gap-0.5" role="row">
          {/* Метка строки */}
          <div className="w-5 shrink-0 flex items-center justify-center text-[9px] font-mono text-radar-dim">
            {rowIndex}
          </div>

          {/* Ячейки */}
          {COLUMNS.map((col, colIndex) => {
            const coord = (col + row) as Coordinate;
            const state = board[coord];

            return (
              <button
                key={coord}
                role="gridcell"
                aria-label={`${col}${rowIndex} — ${state ?? "пусто"}`}
                className={cellClass(state, isEnemy)}
                onClick={() => onCellClick?.(coord)}
                // На своём поле кнопки декоративные; на вражеском — активные
                disabled={!isEnemy || state === "hit" || state === "miss" || state === "sunk"}
              >
                {cellSymbol(state, isEnemy)}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}