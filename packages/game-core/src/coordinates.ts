// packages/game-core/src/coordinates.ts

import type { Coordinate } from './types.js';

// ── Константы поля ────────────────────────────────────────────────────────────

/**
 * 10 столбцов — каждый кодируется 3-буквенной кириллической строкой.
 * Индекс в массиве = colIndex (0..9).
 */
export const COLUMNS = [
  'АБВ', // 0
  'ГДЕ', // 1
  'ЖЗИ', // 2
  'ЙКЛ', // 3
  'МНО', // 4
  'ПРС', // 5
  'ТУФ', // 6
  'ХЦЧ', // 7
  'ШЩЪ', // 8
  'ЫЭЮ', // 9
] as const;

/**
 * 10 строк — трёхзначные десятичные коды с ведущими нулями.
 * Индекс в массиве = rowIndex (0..9).
 */
export const ROWS = [
  '000', // 0
  '001', // 1
  '002', // 2
  '003', // 3
  '004', // 4
  '005', // 5
  '006', // 6
  '007', // 7
  '008', // 8
  '009', // 9
] as const;

// Быстрые Set-ы для O(1)-проверки
const COLUMN_SET = new Set<string>(COLUMNS);
const ROW_SET    = new Set<string>(ROWS);

// ── Публичные функции ─────────────────────────────────────────────────────────

/**
 * Строгая проверка: строка должна иметь ровно 6 символов,
 * первые 3 — валидный столбец, последние 3 — валидная строка.
 */
export function isValidCoordinate(str: string): str is Coordinate {
  if (str.length !== 6) return false;
  return COLUMN_SET.has(str.slice(0, 3)) && ROW_SET.has(str.slice(3, 6));
}

/**
 * Создаёт валидную Coordinate из числовых индексов.
 * @throws RangeError если colIndex или rowIndex выходят за пределы 0–9.
 */
export function makeCoordinate(colIndex: number, rowIndex: number): Coordinate {
  if (
    !Number.isInteger(colIndex) || colIndex < 0 || colIndex > 9 ||
    !Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex > 9
  ) {
    throw new RangeError(
      `makeCoordinate: индексы должны быть целыми числами 0–9, получено col=${colIndex}, row=${rowIndex}`,
    );
  }
  // Диапазон 0–9 проверен выше — ! безопасен, undefined невозможен.
  return (COLUMNS[colIndex]! + ROWS[rowIndex]!) as Coordinate;
}

/**
 * Разбирает Coordinate обратно в числовые индексы.
 * Бренд гарантирует, что строка прошла isValidCoordinate,
 * поэтому indexOf никогда не вернёт -1 в штатном коде.
 */
export function parseCoordinate(coord: Coordinate): { colIndex: number; rowIndex: number } {
  const col = coord.slice(0, 3);
  const row = coord.slice(3, 6);
  // indexOf возвращает number, но не сужается до «не -1» через guard —
  // поэтому TypeScript считает COLUMNS[colIndex] как T | undefined.
  // Явная проверка + throw решает проблему без приведения типов.
  const colIndex = COLUMNS.indexOf(col as typeof COLUMNS[number]);
  const rowIndex = ROWS.indexOf(row as typeof ROWS[number]);
  if (colIndex === -1 || rowIndex === -1) {
    throw new Error(`parseCoordinate: невалидная координата «${coord}»`);
  }
  return { colIndex, rowIndex };
}

/**
 * Возвращает все валидные соседние координаты по 8 направлениям
 * (полный квадрат 3×3 без центра: горизонталь, вертикаль, 4 диагонали).
 *
 * Логика: перебираем смещения dCol и dRow из {-1, 0, +1} × {-1, 0, +1},
 * исключаем (0, 0), формируем новые индексы и фильтруем выходящие
 * за границы 0–9.
 *
 * 8 направлений используются намеренно: по ТЗ корабли не должны
 * соприкасаться включая диагонали, поэтому зона отчуждения — полный квадрат.
 */
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