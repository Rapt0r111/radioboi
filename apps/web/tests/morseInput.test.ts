import { describe, expect, test } from "bun:test";
import { makeCoordinate } from "@radioboi/game-core";
import {
  applyMorseInputChar,
  decodeBoardMorseSequence,
  decodeIncomingMissileTarget,
} from "../src/lib/morseInput";

const expected = { letter: "А", digit: "5" };

describe("beginner Morse input", () => {
  test("restarts only the letter after a wrong letter", () => {
    expect(applyMorseInputChar([], "Б", expected, true)).toEqual({
      chars: [],
      wrongPart: "letter",
    });
  });

  test("keeps the correct letter after a wrong digit", () => {
    expect(applyMorseInputChar(["А"], "6", expected, true)).toEqual({
      chars: ["А"],
      wrongPart: "digit",
    });
  });

  test("accepts the next character in beginner mode and preserves classic mode", () => {
    expect(applyMorseInputChar([], "А", expected, true)).toEqual({ chars: ["А"] });
    expect(applyMorseInputChar(["А"], "6", expected, false)).toEqual({ chars: ["А", "6"] });
  });

  test("decodes a board signal to the expected coordinate", () => {
    expect(decodeBoardMorseSequence([".", "-", ".", "-", "-", "-", "-"])).toBe(
      makeCoordinate(0, 0),
    );
  });

  test("does not reveal the incoming cell in expert mode", () => {
    const sequence = [".", "-", ".", "-", "-", "-", "-"] as const;
    expect(decodeIncomingMissileTarget(sequence, "normal")).toBe(makeCoordinate(0, 0));
    expect(decodeIncomingMissileTarget(sequence, "expert")).toBeNull();
  });
});
