import {
  BOARD_ROW_LABELS,
  COLUMN_MORSE_DIGITS,
  morseNotationToCoordinate,
  type Coordinate,
  type DifficultyMode,
  type MorseSymbol,
} from "@radioboi/game-core";
import { MORSE_ALPHABET } from "@radioboi/morse-engine";

export type MorseInputPart = "letter" | "digit";

export type MorseExpectedParts = {
  letter: string;
  digit: string;
};

export type MorseInputResult = {
  chars: string[];
  wrongPart?: MorseInputPart;
};

export const BOARD_REVERSE_MORSE: Readonly<Record<string, string>> = (() => {
  const reverse: Record<string, string> = {};
  for (const char of [...BOARD_ROW_LABELS, ...COLUMN_MORSE_DIGITS]) {
    const morse = MORSE_ALPHABET[char];
    if (morse !== undefined) reverse[morse] = char;
  }
  return reverse;
})();

/**
 * In beginner mode, reject a wrong part without advancing the coordinate:
 * a wrong letter starts the letter again, while a wrong digit keeps the
 * already decoded letter on screen.
 */
export function applyMorseInputChar(
  currentChars: readonly string[],
  nextChar: string,
  expected: MorseExpectedParts | null,
  isBeginnerMode: boolean,
): MorseInputResult {
  if (!isBeginnerMode || expected === null) {
    return { chars: [...currentChars, nextChar] };
  }

  if (currentChars.length === 0 && nextChar !== expected.letter) {
    return { chars: [], wrongPart: "letter" };
  }

  if (currentChars.length === 1 && nextChar !== expected.digit) {
    return { chars: [...currentChars], wrongPart: "digit" };
  }

  return { chars: [...currentChars, nextChar] };
}

/** Decode the board-only two-part Morse signal used by an incoming missile. */
export function decodeBoardMorseSequence(sequence: readonly MorseSymbol[]): Coordinate | null {
  const flat = sequence.join("");
  for (let splitAt = 1; splitAt < flat.length; splitAt += 1) {
    const letter = BOARD_REVERSE_MORSE[flat.slice(0, splitAt)];
    const digit = BOARD_REVERSE_MORSE[flat.slice(splitAt)];
    if (letter === undefined || digit === undefined) continue;

    try {
      return morseNotationToCoordinate(letter, digit);
    } catch {
      // Keep searching if a future board alphabet adds an ambiguous token.
    }
  }

  return null;
}

/** Expert mode must not learn the cell from the incoming Morse payload. */
export function decodeIncomingMissileTarget(
  sequence: readonly MorseSymbol[],
  difficulty: DifficultyMode,
): Coordinate | null {
  if (difficulty === "expert") return null;
  return decodeBoardMorseSequence(sequence);
}
