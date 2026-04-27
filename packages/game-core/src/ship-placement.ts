// packages/game-core/src/ship-placement.ts
// Pure ship-placement validation. No side-effects, no I/O.

import {
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

/**
 * Returns true if the coords form a valid straight line
 * (all same column OR all same row) with no gaps.
 */
function isLinear(coords: readonly Coordinate[]): boolean {
  if (coords.length === 0) return false;

  const parsed = coords.map(parseCoordinate);

  // FIX(noNonNullAssertion): extract first element to a local variable and
  // guard. Since coords.length > 0 we know parsed[0] exists, but TypeScript
  // types array access as `T | undefined` with noUncheckedIndexedAccess.
  const first = parsed[0];
  if (!first) return false;

  const allSameCol = parsed.every((p) => p.colIndex === first.colIndex);
  const allSameRow = parsed.every((p) => p.rowIndex === first.rowIndex);

  if (!allSameCol && !allSameRow) return false;

  // Check contiguity (no gaps).
  // FIX(noNonNullAssertion): use local variables with guards instead of `!`.
  // In a sorted array of length N, index i and i-1 are always in bounds when
  // 1 ≤ i < N, but TS cannot verify this statically with noUncheckedIndexedAccess.
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

export function validatePlacement(
  ships: ReadonlyArray<{ coords: readonly Coordinate[] }>,
): PlacementResult {
  // ── 1. Validate all coordinates ──────────────────────────────────────────
  for (const ship of ships) {
    for (const coord of ship.coords) {
      if (!isValidCoordinate(coord)) {
        return { ok: false, error: { kind: "INVALID_COORDINATE", coord } };
      }
    }
  }

  // ── 2. Each ship must be linear and at least 1 cell long ─────────────────
  // FIX(noNonNullAssertion): use a local variable with a guard instead of ships[i]!
  for (let i = 0; i < ships.length; i++) {
    const ship = ships[i];
    if (!ship) continue; // unreachable — i < ships.length
    if (ship.coords.length < 1) {
      return { ok: false, error: { kind: "SHIP_TOO_SHORT" } };
    }
    if (ship.coords.length > 1 && !isLinear(ship.coords)) {
      return { ok: false, error: { kind: "SHIP_NOT_LINEAR", shipIndex: i } };
    }
  }

  // ── 3. No overlaps ────────────────────────────────────────────────────────
  const occupied = new Set<Coordinate>();
  for (const ship of ships) {
    for (const coord of ship.coords) {
      if (occupied.has(coord)) {
        return { ok: false, error: { kind: "SHIPS_OVERLAP" } };
      }
      occupied.add(coord);
    }
  }

  // ── 4. No adjacency (including diagonals) ────────────────────────────────
  // FIX(noNonNullAssertion): guard ships[i] and ships[j] with local variables.
  for (let i = 0; i < ships.length; i++) {
    const shipI = ships[i];
    if (!shipI) continue; // unreachable

    const exclusionZone = new Set<Coordinate>(
      shipI.coords.flatMap((c) => getAdjacentCoordinates(c)),
    );
    for (let j = i + 1; j < ships.length; j++) {
      const shipJ = ships[j];
      if (!shipJ) continue; // unreachable

      for (const coord of shipJ.coords) {
        if (exclusionZone.has(coord)) {
          return { ok: false, error: { kind: "SHIPS_TOUCH", shipA: i, shipB: j } };
        }
      }
    }
  }

  // ── 5. Fleet composition ─────────────────────────────────────────────────
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
    throw new RangeError(`colIndexToMorseLetter: index ${colIndex} out of 0–9`);
  }
  return String.fromCharCode(65 + colIndex);
}

export function morseLetterToColIndex(letter: string): number {
  const idx = letter.toUpperCase().charCodeAt(0) - 65;
  if (idx < 0 || idx > 9) {
    throw new RangeError(
      `morseLetterToColIndex: letter "${letter}" maps to index ${idx}, out of 0–9`,
    );
  }
  return idx;
}

export function coordinateToMorseNotation(coord: Coordinate): { letter: string; digit: string } {
  const { colIndex, rowIndex } = parseCoordinate(coord);
  return {
    letter: colIndexToMorseLetter(colIndex),
    digit: String(rowIndex),
  };
}

export function morseNotationToCoordinate(letter: string, digit: string): Coordinate {
  const colIndex = morseLetterToColIndex(letter);
  const rowIndex = parseInt(digit, 10);
  // FIX(noGlobalIsNan): use Number.isNaN — the global isNaN coerces its argument.
  if (Number.isNaN(rowIndex) || rowIndex < 0 || rowIndex > 9) {
    throw new RangeError(`morseNotationToCoordinate: digit "${digit}" out of 0–9`);
  }
  return makeCoordinate(colIndex, rowIndex);
}
