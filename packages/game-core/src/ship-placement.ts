// packages/game-core/src/ship-placement.ts
// Pure ship-placement validation.  No side-effects, no I/O.
// Used by the Cloudflare Worker to authorise SHIPS_PLACED events
// and by the client-side placement UI for immediate feedback.

import {
  getAdjacentCoordinates,
  isValidCoordinate,
  makeCoordinate,
  parseCoordinate,
} from "./coordinates.js";
import type { Board, Coordinate } from "./types.js";

// ── Fleet definition ──────────────────────────────────────────────────────────

/**
 * Required fleet per the technical specification.
 * Key = ship length, value = number of ships of that length.
 */
export const REQUIRED_FLEET: ReadonlyMap<number, number> = new Map([
  [4, 1],
  [3, 2],
  [2, 3],
  [1, 4],
]);

/** Total cells occupied by a valid fleet. */
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

  const allSameCol = parsed.every((p) => p.colIndex === parsed[0]!.colIndex);
  const allSameRow = parsed.every((p) => p.rowIndex === parsed[0]!.rowIndex);

  if (!allSameCol && !allSameRow) return false;

  // Check contiguity (no gaps)
  if (allSameCol) {
    const rows = parsed.map((p) => p.rowIndex).sort((a, b) => a - b);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]! - rows[i - 1]! !== 1) return false;
    }
  } else {
    const cols = parsed.map((p) => p.colIndex).sort((a, b) => a - b);
    for (let i = 1; i < cols.length; i++) {
      if (cols[i]! - cols[i - 1]! !== 1) return false;
    }
  }

  return true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validates a complete fleet placement.
 *
 * Rules enforced:
 * 1. All coordinates are syntactically valid.
 * 2. Each ship occupies ≥ 1 cell and forms a straight contiguous line.
 * 3. No two ships share a cell (no overlaps).
 * 4. No two ships are adjacent (including diagonals).
 * 5. The fleet matches REQUIRED_FLEET exactly.
 */
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
  for (let i = 0; i < ships.length; i++) {
    const ship = ships[i]!;
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
  for (let i = 0; i < ships.length; i++) {
    const exclusionZone = new Set<Coordinate>(
      ships[i]!.coords.flatMap((c) => getAdjacentCoordinates(c)),
    );
    for (let j = i + 1; j < ships.length; j++) {
      for (const coord of ships[j]!.coords) {
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
  // Also reject extra sizes not in REQUIRED_FLEET
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

/**
 * Converts a list of ship coordinate arrays into a Board where
 * each occupied cell is marked `'ship'`.
 * Assumes the placement has already been validated.
 */
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

/**
 * Groups all ship coords into per-ship arrays so the server can
 * detect sunk ships efficiently.
 * Returns an array where each element is the Set of coords for one ship.
 */
export function buildShipSets(
  ships: ReadonlyArray<{ coords: readonly Coordinate[] }>,
): Array<Set<Coordinate>> {
  return ships.map((s) => new Set(s.coords));
}

/**
 * Checks if all cells of a ship have been hit.
 * `hitCells` is the set of coordinates already hit on the target's board.
 */
export function isShipSunk(
  shipCoords: Set<Coordinate>,
  hitCells: ReadonlySet<Coordinate>,
): boolean {
  for (const coord of shipCoords) {
    if (!hitCells.has(coord)) return false;
  }
  return true;
}

/**
 * Returns true when every ship in the fleet is sunk.
 */
export function isFleetDestroyed(
  ships: Array<Set<Coordinate>>,
  hitCells: ReadonlySet<Coordinate>,
): boolean {
  return ships.every((ship) => isShipSunk(ship, hitCells));
}

/**
 * Given a target coordinate, finds which ship (if any) it belongs to.
 * Returns the ship's Set if found, otherwise undefined.
 */
export function findShipAt(
  target: Coordinate,
  ships: Array<Set<Coordinate>>,
): Set<Coordinate> | undefined {
  return ships.find((s) => s.has(target));
}

// ── Coordinate ↔ Morse index mapping ─────────────────────────────────────────

/**
 * Maps a column index (0–9) to its single Morse letter (A–J).
 * Used to convert internal Coordinate format to Morse-transmittable form.
 */
export function colIndexToMorseLetter(colIndex: number): string {
  if (colIndex < 0 || colIndex > 9) {
    throw new RangeError(`colIndexToMorseLetter: index ${colIndex} out of 0–9`);
  }
  return String.fromCharCode(65 + colIndex); // A=65
}

/**
 * Maps a Morse letter (A–J, case-insensitive) back to a column index.
 */
export function morseLetterToColIndex(letter: string): number {
  const idx = letter.toUpperCase().charCodeAt(0) - 65;
  if (idx < 0 || idx > 9) {
    throw new RangeError(
      `morseLetterToColIndex: letter "${letter}" maps to index ${idx}, out of 0–9`,
    );
  }
  return idx;
}

/**
 * Converts a Coordinate to its simplified Morse notation.
 * ColIndex → letter A–J, RowIndex → digit 0–9.
 */
export function coordinateToMorseNotation(coord: Coordinate): { letter: string; digit: string } {
  const { colIndex, rowIndex } = parseCoordinate(coord);
  return {
    letter: colIndexToMorseLetter(colIndex),
    digit: String(rowIndex),
  };
}

/**
 * Inverse of coordinateToMorseNotation.
 * @param letter  A–J (column)
 * @param digit   0–9 (row)
 */
export function morseNotationToCoordinate(letter: string, digit: string): Coordinate {
  const colIndex = morseLetterToColIndex(letter);
  const rowIndex = parseInt(digit, 10);
  if (isNaN(rowIndex) || rowIndex < 0 || rowIndex > 9) {
    throw new RangeError(`morseNotationToCoordinate: digit "${digit}" out of 0–9`);
  }
  return makeCoordinate(colIndex, rowIndex);
}
