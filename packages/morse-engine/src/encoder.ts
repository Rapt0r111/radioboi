// packages/morse-engine/src/encoder.ts
// Преобразует строку в плоский массив тайминговых единиц Морзе.
// Положительные числа — звук, отрицательные — пауза.

import { MORSE_ALPHABET } from "./alphabet.js";

// ── Длительности в условных единицах ─────────────────────────────────────────

const DOT = 1; // точка
const DASH = 3; // тире
const EL_GAP = -1; // пауза между элементами знака
const CHAR_GAP = -3; // пауза между знаками (буквами)
const WORD_GAP = -7; // пауза между словами

// ── Вспомогательные функции ────────────────────────────────────────────────────

/**
 * Кодирует одну морзе-последовательность знака в тайминговые единицы.
 * Пример: ".--" → [1, -1, 3, -1, 3]
 * Межэлементная пауза вставляется МЕЖДУ элементами, но не в конце.
 */
function encodeSymbol(morse: string): number[] {
  const elements = [...morse]; // Unicode-safe split
  const out: number[] = [];

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el === undefined) continue; // noUncheckedIndexedAccess guard

    if (i > 0) {
      out.push(EL_GAP);
    }
    out.push(el === "." ? DOT : DASH);
  }

  return out;
}

// ── Публичный API ──────────────────────────────────────────────────────────────

/**
 * Кодирует текст в плоский массив тайминговых единиц Морзе.
 *
 * Правила:
 * - Точка = 1, Тире = 3
 * - Пауза между элементами знака = −1
 * - Пауза между знаками (буквами) = −3
 * - Пауза между словами = −7
 *
 * Пример: 'А' (.-) → [1, −1, 3, −3]
 *
 * Неизвестные символы молча пропускаются.
 * Строка нормализуется в верхний регистр перед обработкой.
 */
export function encodeToMorse(text: string): number[] {
  const result: number[] = [];
  const words = text.toUpperCase().trim().split(/\s+/);

  for (let wi = 0; wi < words.length; wi++) {
    const word = words[wi];
    if (!word) continue; // noUncheckedIndexedAccess guard + skip empty

    // Unicode-safe split into characters
    const chars = [...word].filter((ch) => MORSE_ALPHABET[ch] !== undefined);
    if (chars.length === 0) continue;

    for (let ci = 0; ci < chars.length; ci++) {
      const char = chars[ci];
      if (char === undefined) continue;

      const morse = MORSE_ALPHABET[char];
      if (morse === undefined) continue;

      // Append timed elements for this character
      for (const unit of encodeSymbol(morse)) {
        result.push(unit);
      }

      // Determine trailing gap
      const isLastCharInWord = ci === chars.length - 1;
      const isLastWord = wi === words.length - 1;

      if (!isLastCharInWord) {
        // More characters in this word
        result.push(CHAR_GAP);
      } else if (!isLastWord) {
        // End of word, more words follow → word gap
        result.push(WORD_GAP);
      } else {
        // Very last character — still append letter pause (matches example)
        result.push(CHAR_GAP);
      }
    }
  }

  return result;
}
