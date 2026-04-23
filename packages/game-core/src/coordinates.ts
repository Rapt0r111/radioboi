// packages/game-core/src/coordinates.ts

import type { Coordinate } from "./types.js";

// ── Константы поля ────────────────────────────────────────────────────────────

export const COLUMNS = [
  "АБВ", // 0
  "ГДЕ", // 1
  "ЖЗИ", // 2
  "ЙКЛ", // 3
  "МНО", // 4
  "ПРС", // 5
  "ТУФ", // 6
  "ХЦЧ", // 7
  "ШЩЪ", // 8
  "ЫЭЮ", // 9
] as const;

export const ROWS = [
  "000", // 0
  "001", // 1
  "002", // 2
  "003", // 3
  "004", // 4
  "005", // 5
  "006", // 6
  "007", // 7
  "008", // 8
  "009", // 9
] as const;

const COLUMN_SET = new Set<string>(COLUMNS);
const ROW_SET = new Set<string>(ROWS);

// ── Публичные функции ─────────────────────────────────────────────────────────

export function isValidCoordinate(str: string): str is Coordinate {
  if (str.length !== 6) return false;
  return COLUMN_SET.has(str.slice(0, 3)) && ROW_SET.has(str.slice(3, 6));
}

export function makeCoordinate(colIndex: number, rowIndex: number): Coordinate {
  if (
    !Number.isInteger(colIndex) ||
    colIndex < 0 ||
    colIndex > 9 ||
    !Number.isInteger(rowIndex) ||
    rowIndex < 0 ||
    rowIndex > 9
  ) {
    throw new RangeError(
      `makeCoordinate: индексы должны быть целыми числами 0–9, получено col=${colIndex}, row=${rowIndex}`,
    );
  }
  // FIX(noNonNullAssertion): replace COLUMNS[colIndex]! + ROWS[rowIndex]! with
  // explicit guards. The range check above guarantees both values exist, but
  // biome's noNonNullAssertion rule forbids the `!` operator regardless.
  // Using explicit guards keeps the code correct without assertions.
  const col = COLUMNS[colIndex];
  const row = ROWS[rowIndex];
  if (col === undefined || row === undefined) {
    // Unreachable — range is validated by the guard above.
    throw new RangeError(`makeCoordinate: unreachable state col=${colIndex} row=${rowIndex}`);
  }
  return (col + row) as Coordinate;
}

export function parseCoordinate(coord: Coordinate): { colIndex: number; rowIndex: number } {
  const col = coord.slice(0, 3);
  const row = coord.slice(3, 6);
  const colIndex = COLUMNS.indexOf(col as (typeof COLUMNS)[number]);
  const rowIndex = ROWS.indexOf(row as (typeof ROWS)[number]);
  if (colIndex === -1 || rowIndex === -1) {
    throw new Error(`parseCoordinate: невалидная координата «${coord}»`);
  }
  return { colIndex, rowIndex };
}

export function getAdjacentCoordinates(coord: Coordinate): Coordinate[] {
  const { colIndex, rowIndex } = parseCoordinate(coord);
  const result: Coordinate[] = [];

  for (let dCol = -1; dCol <= 1; dCol++) {
    for (let dRow = -1; dRow <= 1; dRow++) {
      if (dCol === 0 && dRow === 0) continue;
      const newCol = colIndex + dCol;
      const newRow = rowIndex + dRow;
      if (newCol >= 0 && newCol <= 9 && newRow >= 0 && newRow <= 9) {
        result.push(makeCoordinate(newCol, newRow));
      }
    }
  }

  return result;
}
