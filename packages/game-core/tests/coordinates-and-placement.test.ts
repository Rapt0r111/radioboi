import { describe, expect, test } from "bun:test";
import {
  buildBoardFromShips,
  coordinateToMorseNotation,
  findShipAt,
  isFleetDestroyed,
  isShipSunk,
  isValidCoordinate,
  makeCoordinate,
  morseNotationToCoordinate,
  parseCoordinate,
  validateGeometry,
  validatePlacement,
} from "../src";

function validFleet() {
  return [
    { coords: [0, 1, 2, 3].map((col) => makeCoordinate(col, 0)) },
    { coords: [0, 1, 2].map((col) => makeCoordinate(col, 2)) },
    { coords: [0, 1, 2].map((col) => makeCoordinate(col, 4)) },
    { coords: [0, 1].map((col) => makeCoordinate(col, 6)) },
    { coords: [3, 4].map((col) => makeCoordinate(col, 6)) },
    { coords: [6, 7].map((col) => makeCoordinate(col, 6)) },
    { coords: [makeCoordinate(0, 8)] },
    { coords: [makeCoordinate(2, 8)] },
    { coords: [makeCoordinate(4, 8)] },
    { coords: [makeCoordinate(6, 8)] },
  ];
}

describe("coordinate helpers", () => {
  test("create, validate, and parse board coordinates", () => {
    const coord = makeCoordinate(9, 9);

    expect(isValidCoordinate(coord)).toBe(true);
    expect(parseCoordinate(coord)).toEqual({ colIndex: 9, rowIndex: 9 });
    expect(() => makeCoordinate(-1, 0)).toThrow(RangeError);
    expect(() => makeCoordinate(0, 10)).toThrow(RangeError);
  });

  test("round-trips coordinates through Morse notation", () => {
    const coord = makeCoordinate(4, 7);
    const notation = coordinateToMorseNotation(coord);

    expect(notation).toEqual({ letter: "E", digit: "7" });
    expect(morseNotationToCoordinate(notation.letter, notation.digit)).toBe(coord);
  });
});

describe("ship placement validation", () => {
  test("accepts a complete non-touching fleet", () => {
    const ships = validFleet();

    expect(validateGeometry(ships)).toEqual({ ok: true });
    expect(validatePlacement(ships)).toEqual({ ok: true });
  });

  test("rejects overlapping, touching, and non-linear ships", () => {
    expect(
      validateGeometry([
        { coords: [makeCoordinate(0, 0), makeCoordinate(1, 0)] },
        { coords: [makeCoordinate(1, 0)] },
      ]),
    ).toEqual({ ok: false, error: { kind: "SHIPS_OVERLAP" } });

    expect(
      validateGeometry([
        { coords: [makeCoordinate(0, 0)] },
        { coords: [makeCoordinate(1, 1)] },
      ]),
    ).toEqual({ ok: false, error: { kind: "SHIPS_TOUCH", shipA: 0, shipB: 1 } });

    expect(
      validateGeometry([{ coords: [makeCoordinate(0, 0), makeCoordinate(1, 1)] }]),
    ).toEqual({ ok: false, error: { kind: "SHIP_NOT_LINEAR", shipIndex: 0 } });
  });

  test("builds boards and detects sunk fleets", () => {
    const ships = validFleet();
    const board = buildBoardFromShips(ships);
    const shipSets = ships.map((ship) => new Set(ship.coords));
    const target = ships[0]?.coords[0];

    expect(target).toBeDefined();
    expect(board[target!]).toBe("ship");
    expect(findShipAt(target!, shipSets)).toBe(shipSets[0]);
    expect(isShipSunk(shipSets[0]!, new Set(ships[0]!.coords))).toBe(true);
    expect(isFleetDestroyed(shipSets, new Set(Object.keys(board)))).toBe(true);
  });
});
