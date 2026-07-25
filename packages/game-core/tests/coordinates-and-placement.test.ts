import { describe, expect, test } from "bun:test";
import {
  buildBoardFromShips,
  buildShipSets,
  colIndexToMorseLetter,
  coordinateToMorseNotation,
  findShipAt,
  getAdjacentCoordinates,
  isFleetDestroyed,
  isShipSunk,
  isValidCoordinate,
  makeCoordinate,
  morseLetterToColIndex,
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

    expect(notation).toEqual({ letter: "З", digit: "5" });
    expect(morseNotationToCoordinate(notation.letter, notation.digit)).toBe(coord);
  });

  test("uses 1-10 columns and Cyrillic A-K rows for Morse notation", () => {
    expect(coordinateToMorseNotation(makeCoordinate(0, 0))).toEqual({
      letter: "А",
      digit: "1",
    });
    expect(coordinateToMorseNotation(makeCoordinate(9, 0))).toEqual({
      letter: "А",
      digit: "0",
    });
    expect(morseNotationToCoordinate("К", "0")).toBe(makeCoordinate(9, 9));
    expect(morseNotationToCoordinate("Ж", "0")).toBe(makeCoordinate(9, 6));
  });

  test("reports legal adjacent cells for center, edge, and corner coordinates", () => {
    expect(getAdjacentCoordinates(makeCoordinate(5, 5))).toHaveLength(8);
    expect(getAdjacentCoordinates(makeCoordinate(0, 5))).toHaveLength(5);
    expect(getAdjacentCoordinates(makeCoordinate(0, 0))).toEqual([
      makeCoordinate(0, 1),
      makeCoordinate(1, 0),
      makeCoordinate(1, 1),
    ]);
  });

  test("rejects invalid coordinate and Morse notation inputs", () => {
    expect(isValidCoordinate("BAD")).toBe(false);
    expect(() => parseCoordinate("BAD" as never)).toThrow("parseCoordinate");
    expect(() => makeCoordinate(1.5, 0)).toThrow(RangeError);
    expect(() => colIndexToMorseLetter(10)).toThrow(RangeError);
    expect(() => morseLetterToColIndex("Z")).toThrow(RangeError);
    expect(() => morseNotationToCoordinate("А", "11")).toThrow(RangeError);
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

  test("rejects empty, invalid, gapped, and wrong-composition fleets", () => {
    expect(validateGeometry([{ coords: [] }])).toEqual({
      ok: false,
      error: { kind: "SHIP_TOO_SHORT" },
    });
    expect(validateGeometry([{ coords: ["BAD" as never] }])).toEqual({
      ok: false,
      error: { kind: "INVALID_COORDINATE", coord: "BAD" },
    });
    expect(
      validateGeometry([{ coords: [makeCoordinate(0, 0), makeCoordinate(2, 0)] }]),
    ).toEqual({ ok: false, error: { kind: "SHIP_NOT_LINEAR", shipIndex: 0 } });
    expect(validatePlacement([{ coords: [makeCoordinate(0, 0)] }])).toEqual({
      ok: false,
      error: {
        kind: "WRONG_FLEET",
        expected: "{\"1\":4,\"2\":3,\"3\":2,\"4\":1}",
        got: "{\"1\":1}",
      },
    });
  });

  test("builds boards and detects sunk fleets", () => {
    const ships = validFleet();
    const board = buildBoardFromShips(ships);
    const shipSets = buildShipSets(ships);
    const target = ships[0]?.coords[0];

    expect(target).toBeDefined();
    expect(board[target!]).toBe("ship");
    expect(findShipAt(target!, shipSets)).toBe(shipSets[0]);
    expect(findShipAt(makeCoordinate(9, 9), shipSets)).toBeUndefined();
    expect(isShipSunk(shipSets[0]!, new Set([ships[0]!.coords[0]!]))).toBe(false);
    expect(isShipSunk(shipSets[0]!, new Set(ships[0]!.coords))).toBe(true);
    expect(isFleetDestroyed(shipSets, new Set(Object.keys(board)))).toBe(true);
  });
});
