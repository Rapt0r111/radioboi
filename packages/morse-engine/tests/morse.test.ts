import { describe, expect, test } from "bun:test";
import { encodeToMorse, FuzzyDecoder, MORSE_ALPHABET } from "../src";

describe("Morse alphabet and timing encoder", () => {
  test("encodes latin letters and digits with standard timing gaps", () => {
    expect(MORSE_ALPHABET.A).toBe(".-");
    expect(MORSE_ALPHABET["7"]).toBe("--...");
    expect(encodeToMorse("A 7")).toEqual([1, -1, 3, -7, 3, -1, 3, -1, 1, -1, 1, -1, 1, -3]);
  });

  test("skips unknown characters instead of emitting invalid timings", () => {
    expect(encodeToMorse("@")).toEqual([]);
    expect(encodeToMorse("A@")).toEqual([1, -1, 3, -3]);
  });
});

describe("FuzzyDecoder", () => {
  test("classifies dot and dash durations and flushes a character", () => {
    const symbols: string[] = [];
    const chars: string[] = [];
    const decoder = new FuzzyDecoder({
      dotDuration: 100,
      onSymbol: (symbol) => symbols.push(symbol),
      onChar: (char) => chars.push(char),
    });

    decoder.pointerDown(0);
    decoder.pointerUp(80);
    decoder.pointerDown(200);
    decoder.pointerUp(380);

    expect(symbols).toEqual([".", "-"]);
    expect(decoder.flush()).toBe("A");
    expect(chars).toEqual(["A"]);
  });

  test("updates the dot duration threshold at runtime", () => {
    const decoder = new FuzzyDecoder({ dotDuration: 100 });
    decoder.setDotDuration(20);

    decoder.pointerDown(0);
    decoder.pointerUp(35);

    expect(decoder.currentMorse).toBe("-");
  });

  test("can prefer a custom reverse map for ambiguous Cyrillic screen codes", () => {
    const decoder = new FuzzyDecoder({
      dotDuration: 100,
      reverseMap: {
        ".--": "В",
        "...-": "Ж",
        "--..": "З",
      },
    });

    decoder.pointerDown(0);
    decoder.pointerUp(80);
    decoder.pointerDown(200);
    decoder.pointerUp(380);
    decoder.pointerDown(500);
    decoder.pointerUp(680);

    expect(decoder.flush()).toBe("В");
  });
});
