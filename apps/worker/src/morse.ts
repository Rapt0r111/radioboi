// apps/worker/src/morse.ts
// Self-contained Morse encoder / decoder for the Worker.
// Covers A–Z and 0–9 (international standard).
// Used by GameRoomArbitrator to verify that the attacker's Morse
// sequence matches the coordinate stored in ATTACK_PREP.
//
// NOTE: Only letters A–J (columns 0–9) and digits 0–9 (rows) are
// used in this game.  The full alphabet is included for correctness.

// ── Code table ────────────────────────────────────────────────────────────────

const MORSE_TABLE: Readonly<Record<string, string>> = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
  "0": "-----",
  "1": ".----",
  "2": "..---",
  "3": "...--",
  "4": "....-",
  "5": ".....",
  "6": "-....",
  "7": "--...",
  "8": "---..",
  "9": "----.",
};

// Reverse lookup: morse string → character
const REVERSE_TABLE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MORSE_TABLE).map(([char, morse]) => [morse, char]),
);

// ── Types ─────────────────────────────────────────────────────────────────────

/** A full coordinate encoded as two Morse tokens: [letterMorse, digitMorse]. */
export type CoordMorseTokens = [string, string];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Encodes a single character (A–Z or 0–9) to its Morse string.
 * Returns null for unknown characters.
 */
export function charToMorse(char: string): string | null {
  return MORSE_TABLE[char.toUpperCase()] ?? null;
}

/**
 * Decodes a Morse string back to a character.
 * Returns null for unrecognised sequences.
 */
export function morseToChar(morse: string): string | null {
  return REVERSE_TABLE[morse] ?? null;
}

/**
 * Converts a column index (0–9) + row index (0–9) into two Morse strings.
 * Column maps to letter A–J, row maps to digit 0–9.
 *
 * @returns [columnMorse, rowMorse]
 */
export function coordIndicesToMorse(colIndex: number, rowIndex: number): CoordMorseTokens {
  const letter = String.fromCharCode(65 + colIndex); // A–J
  const digit = String(rowIndex); // 0–9
  const colMorse = MORSE_TABLE[letter];
  const rowMorse = MORSE_TABLE[digit];
  if (colMorse === undefined || rowMorse === undefined) {
    throw new RangeError(`coordIndicesToMorse: invalid indices col=${colIndex} row=${rowIndex}`);
  }
  return [colMorse, rowMorse];
}

/**
 * Decodes two Morse tokens back to [colIndex, rowIndex].
 * Returns null if either token is unrecognised.
 */
export function morseToCoordIndices(
  colMorse: string,
  rowMorse: string,
): { colIndex: number; rowIndex: number } | null {
  const letter = REVERSE_TABLE[colMorse];
  const digit = REVERSE_TABLE[rowMorse];

  if (!letter || !digit) return null;

  const colIndex = letter.charCodeAt(0) - 65; // A→0 … J→9
  const rowIndex = parseInt(digit, 10);

  // FIX(noGlobalIsNan): use Number.isNaN — the global isNaN coerces its
  // argument before testing, which can mask bugs. Number.isNaN is strict.
  if (colIndex < 0 || colIndex > 9 || Number.isNaN(rowIndex) || rowIndex < 0 || rowIndex > 9) {
    return null;
  }

  return { colIndex, rowIndex };
}

/**
 * Splits a flat MorseSequence (array of dots/dashes) into [colToken, rowToken]
 * using the known lengths from MORSE_TABLE.
 *
 * The client transmits a flat sequence; the server must split it at the
 * boundary between the column letter and the row digit.
 *
 * Strategy: try every split point from 1 to len-1 and return the first
 * pair where both halves map to valid entries.
 */
export function splitMorseSequence(sequence: readonly string[]): CoordMorseTokens | null {
  const flat = sequence.join("");
  for (let splitAt = 1; splitAt < flat.length; splitAt++) {
    const colToken = flat.slice(0, splitAt);
    const rowToken = flat.slice(splitAt);
    const decoded = morseToCoordIndices(colToken, rowToken);
    if (decoded !== null) {
      return [colToken, rowToken];
    }
  }
  return null;
}

/**
 * High-level validation: confirms that `sequence` (flat dot/dash array)
 * decodes to the coordinate identified by (colIndex, rowIndex).
 *
 * @returns true if the sequence is correct, false otherwise.
 */
export function validateMorseForCoord(
  sequence: readonly string[],
  colIndex: number,
  rowIndex: number,
): boolean {
  const tokens = splitMorseSequence(sequence);
  if (!tokens) return false;
  const decoded = morseToCoordIndices(tokens[0], tokens[1]);
  if (!decoded) return false;
  return decoded.colIndex === colIndex && decoded.rowIndex === rowIndex;
}
