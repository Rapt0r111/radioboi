// packages/game-core/src/ship-placement.ts
// Pure ship-placement validation. No side-effects, no I/O.

import {
  BOARD_ROW_LABELS,
  COLUMN_MORSE_DIGITS,
  getAdjacentCoordinates,
  isValidCoordinate,
  makeCoordinate,
  parseCoordinate,
} from "./coordinates";
import type { Board, Coordinate } from "./types";

// ── Fleet definition ──────────────────────────────────────────────────────────

export const REQUIRED_FLEET: ReadonlyMap<number, number> = new Map([
  [4, 1],
  [3, 2],
  [2, 3],
  [1, 4],
]);

export const FLEET_TOTAL_CELLS: number = [...REQUIRED_FLEET.entries()].reduce(
  (acc, [len, count]) => acc + len * count,
  0,
);

// ── Validation result ─────────────────────────────────────────────────────────

export type PlacementError =
  | { kind: "INVALID_COORDINATE"; coord: string }
  | { kind: "SHIP_TOO_SHORT" }
  | { kind: "SHIP_NOT_LINEAR"; shipIndex: number }
  | { kind: "SHIPS_OVERLAP" }
  | { kind: "SHIPS_TOUCH"; shipA: number; shipB: number }
  | { kind: "WRONG_FLEET"; expected: string; got: string };

export type PlacementResult = { ok: true } | { ok: false; error: PlacementError };

// ── Internal helpers ──────────────────────────────────────────────────────────

function isLinear(coords: readonly Coordinate[]): boolean {
  if (coords.length === 0) return false;

  const parsed = coords.map(parseCoordinate);
  const first = parsed[0];
  if (!first) return false;

  const allSameCol = parsed.every((p) => p.colIndex === first.colIndex);
  const allSameRow = parsed.every((p) => p.rowIndex === first.rowIndex);

  if (!allSameCol && !allSameRow) return false;

  if (allSameCol) {
    const rows = parsed.map((p) => p.rowIndex).sort((a, b) => a - b);
    for (let i = 1; i < rows.length; i++) {
      const curr = rows[i];
      const prev = rows[i - 1];
      if (curr === undefined || prev === undefined) return false;
      if (curr - prev !== 1) return false;
    }
  } else {
    const cols = parsed.map((p) => p.colIndex).sort((a, b) => a - b);
    for (let i = 1; i < cols.length; i++) {
      const curr = cols[i];
      const prev = cols[i - 1];
      if (curr === undefined || prev === undefined) return false;
      if (curr - prev !== 1) return false;
    }
  }

  return true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validates GEOMETRY only: coordinate validity, linearity, overlaps, adjacency.
 *
 * Does NOT check fleet composition. Use this during mid-placement (cell clicks,
 * orientation toggles) to avoid false "WRONG_FLEET" errors when only some ships
 * have been placed yet. Use `validatePlacement` for the final "Ready" check.
 *
 * FIX: Previously all placement clicks called validatePlacement which includes
 * fleet composition check — this made it impossible to re-place a ship after
 * removing it from the board, because the partial fleet never matched REQUIRED_FLEET.
 */
export function validateGeometry(
  ships: ReadonlyArray<{ coords: readonly Coordinate[] }>,
): PlacementResult {
  // 1. Validate all coordinates
  for (const ship of ships) {
    for (const coord of ship.coords) {
      if (!isValidCoordinate(coord)) {
        return { ok: false, error: { kind: "INVALID_COORDINATE", coord } };
      }
    }
  }

  // 2. Each ship must be linear and at least 1 cell long
  for (let i = 0; i < ships.length; i++) {
    const ship = ships[i];
    if (!ship) continue;
    if (ship.coords.length < 1) {
      return { ok: false, error: { kind: "SHIP_TOO_SHORT" } };
    }
    if (ship.coords.length > 1 && !isLinear(ship.coords)) {
      return { ok: false, error: { kind: "SHIP_NOT_LINEAR", shipIndex: i } };
    }
  }

  // 3. No overlaps
  const occupied = new Set<Coordinate>();
  for (const ship of ships) {
    for (const coord of ship.coords) {
      if (occupied.has(coord)) {
        return { ok: false, error: { kind: "SHIPS_OVERLAP" } };
      }
      occupied.add(coord);
    }
  }

  // 4. No adjacency (including diagonals)
  for (let i = 0; i < ships.length; i++) {
    const shipI = ships[i];
    if (!shipI) continue;

    const exclusionZone = new Set<Coordinate>(
      shipI.coords.flatMap((c) => getAdjacentCoordinates(c)),
    );
    for (let j = i + 1; j < ships.length; j++) {
      const shipJ = ships[j];
      if (!shipJ) continue;

      for (const coord of shipJ.coords) {
        if (exclusionZone.has(coord)) {
          return { ok: false, error: { kind: "SHIPS_TOUCH", shipA: i, shipB: j } };
        }
      }
    }
  }

  return { ok: true };
}

/**
 * Full placement validation: geometry + fleet composition.
 * Use ONLY for the final "Ready" button — NOT during individual cell clicks.
 */
export function validatePlacement(
  ships: ReadonlyArray<{ coords: readonly Coordinate[] }>,
): PlacementResult {
  // Run geometry checks first
  const geometryResult = validateGeometry(ships);
  if (!geometryResult.ok) return geometryResult;

  // ── Fleet composition ─────────────────────────────────────────────────
  const actualFleet = new Map<number, number>();
  for (const ship of ships) {
    const len = ship.coords.length;
    actualFleet.set(len, (actualFleet.get(len) ?? 0) + 1);
  }

  for (const [len, count] of REQUIRED_FLEET) {
    if ((actualFleet.get(len) ?? 0) !== count) {
      return {
        ok: false,
        error: {
          kind: "WRONG_FLEET",
          expected: JSON.stringify(Object.fromEntries(REQUIRED_FLEET)),
          got: JSON.stringify(Object.fromEntries(actualFleet)),
        },
      };
    }
  }
  for (const len of actualFleet.keys()) {
    if (!REQUIRED_FLEET.has(len)) {
      return {
        ok: false,
        error: {
          kind: "WRONG_FLEET",
          expected: JSON.stringify(Object.fromEntries(REQUIRED_FLEET)),
          got: JSON.stringify(Object.fromEntries(actualFleet)),
        },
      };
    }
  }

  return { ok: true };
}

export function buildBoardFromShips(
  ships: ReadonlyArray<{ coords: readonly Coordinate[] }>,
): Board {
  const board: Board = {} as Board;
  for (const ship of ships) {
    for (const coord of ship.coords) {
      board[coord] = "ship";
    }
  }
  return board;
}

export function buildShipSets(
  ships: ReadonlyArray<{ coords: readonly Coordinate[] }>,
): Array<Set<Coordinate>> {
  return ships.map((s) => new Set(s.coords));
}

export function isShipSunk(
  shipCoords: Set<Coordinate>,
  hitCells: ReadonlySet<Coordinate>,
): boolean {
  for (const coord of shipCoords) {
    if (!hitCells.has(coord)) return false;
  }
  return true;
}

export function isFleetDestroyed(
  ships: Array<Set<Coordinate>>,
  hitCells: ReadonlySet<Coordinate>,
): boolean {
  return ships.every((ship) => isShipSunk(ship, hitCells));
}

export function findShipAt(
  target: Coordinate,
  ships: Array<Set<Coordinate>>,
): Set<Coordinate> | undefined {
  return ships.find((s) => s.has(target));
}

// ── Coordinate ↔ Morse index mapping ─────────────────────────────────────────

export function colIndexToMorseLetter(colIndex: number): string {
  if (colIndex < 0 || colIndex > 9) {
    throw new RangeError(`colIndexToMorseLetter: index ${colIndex} out of 0?9`);
  }
  const label = BOARD_ROW_LABELS[colIndex];
  if (label === undefined) {
    throw new RangeError(`colIndexToMorseLetter: unreachable index ${colIndex}`);
  }
  return label;
}

export function morseLetterToColIndex(letter: string): number {
  const idx = BOARD_ROW_LABELS.indexOf(
    letter.toUpperCase() as (typeof BOARD_ROW_LABELS)[number],
  );
  if (idx < 0) {
    throw new RangeError(
      `morseLetterToColIndex: letter "${letter}" is not a board row`,
    );
  }
  return idx;
}

export function coordinateToMorseNotation(coord: Coordinate): { letter: string; digit: string } {
  const { colIndex, rowIndex } = parseCoordinate(coord);
  const letter = BOARD_ROW_LABELS[rowIndex];
  const digit = COLUMN_MORSE_DIGITS[colIndex];
  if (letter === undefined || digit === undefined) {
    throw new RangeError(`coordinateToMorseNotation: unreachable coordinate ${coord}`);
  }
  return { letter, digit };
}

export function morseNotationToCoordinate(letter: string, digit: string): Coordinate {
  const rowIndex = morseLetterToColIndex(letter);
  const colIndex = COLUMN_MORSE_DIGITS.indexOf(
    digit as (typeof COLUMN_MORSE_DIGITS)[number],
  );
  if (colIndex < 0) {
    throw new RangeError(`morseNotationToCoordinate: digit "${digit}" is not a board column`);
  }
  return makeCoordinate(colIndex, rowIndex);
}
