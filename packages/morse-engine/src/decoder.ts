// packages/morse-engine/src/decoder.ts
// Нечёткий декодер: принимает временны́е метки нажатий и классифицирует
// их как точки / тире, затем собирает символы через таймаут.

import { MORSE_REVERSE } from "./alphabet";

// ── Типы ──────────────────────────────────────────────────────────────────────

export type MorseSymbol = "." | "-";

export type FuzzyDecoderOptions = {
  /** Базовая длительность точки в мс. По умолчанию 150. */
  dotDuration?: number;
  /** Опциональная таблица декодирования для неоднозначных алфавитов. */
  reverseMap?: Readonly<Record<string, string>>;
  /** Вызывается когда расшифрован полный символ (буква/цифра). */
  onChar?: (char: string) => void;
  /** Вызывается сразу после распознавания точки или тире. */
  onSymbol?: (symbol: MorseSymbol) => void;
  /** Вызывается при паузе, соответствующей границе слова. */
  onWordBreak?: () => void;
};

// ── Константы допусков ────────────────────────────────────────────────────────

/** Максимум длительности точки: dotDuration × 1.3 */
const DOT_MAX_FACTOR = 1.3;
/** Минимум длительности тире: dotDuration × 1.5 */
const DASH_MIN_FACTOR = 1.5;
/** Таймаут завершения символа: dotDuration × 2.5 */
const CHAR_TIMEOUT_FACTOR = 2.5;
/** Доп. задержка после символа для обнаружения паузы между словами. */
const WORD_TIMEOUT_FACTOR = 4.5; // 7 единиц − 2.5 уже истекло

// ── Класс ─────────────────────────────────────────────────────────────────────

export class FuzzyDecoder {
  // FIX BUG 1: убрали readonly — dotDuration теперь изменяется через setDotDuration()
  #dotDuration: number;

  // Callbacks
  readonly #reverseMap: Readonly<Record<string, string>>;
  readonly #onChar: ((char: string) => void) | undefined;
  readonly #onSymbol: ((symbol: MorseSymbol) => void) | undefined;
  readonly #onWordBreak: (() => void) | undefined;

  // Mutable state
  #accumulated: string = "";
  #pressStartMs: number | null = null;
  #charTimer: ReturnType<typeof setTimeout> | null = null;
  #wordTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: FuzzyDecoderOptions = {}) {
    this.#dotDuration = options.dotDuration ?? 150;
    this.#reverseMap = options.reverseMap ?? MORSE_REVERSE;
    this.#onChar = options.onChar;
    this.#onSymbol = options.onSymbol;
    this.#onWordBreak = options.onWordBreak;
  }

  // ── Публичный API ──────────────────────────────────────────────────────────

  get dotDuration(): number {
    return this.#dotDuration;
  }

  /**
   * FIX BUG 1: Обновляет базовую длительность точки в реальном времени.
   * Вызывается при изменении WPM: dotDuration = 1200 / wpm (мс на единицу).
   * Все последующие нажатия будут классифицироваться по новому порогу.
   */
  setDotDuration(ms: number): void {
    this.#dotDuration = Math.max(20, ms); // минимум 20мс для защиты от слишком быстрых тапов
  }

  /** Текущая накопленная морзе-строка (до завершения символа). */
  get currentMorse(): string {
    return this.#accumulated;
  }

  /**
   * Вызвать при нажатии (pointerdown / keydown).
   * @param timestamp Момент нажатия в мс (например, `performance.now()`).
   */
  pointerDown(timestamp: number): void {
    // Новое нажатие сбрасывает таймеры (игрок ещё вводит)
    this.#clearTimers();
    this.#pressStartMs = timestamp;
  }

  /**
   * Вызвать при отпускании (pointerup / keyup).
   * @param timestamp Момент отпускания в мс.
   */
  pointerUp(timestamp: number): void {
    if (this.#pressStartMs === null) return;

    const duration = timestamp - this.#pressStartMs;
    this.#pressStartMs = null;

    // ── Классификация нажатия ─────────────────────────────────────────────
    const symbol = this.#classify(duration);
    this.#accumulated += symbol;
    this.#onSymbol?.(symbol);

    // ── Запуск таймера завершения символа ─────────────────────────────────
    this.#clearTimers();

    this.#charTimer = setTimeout(() => {
      this.#charTimer = null;
      this.#completeChar();

      // После завершения символа ждём паузу между словами
      this.#wordTimer = setTimeout(() => {
        this.#wordTimer = null;
        this.#onWordBreak?.();
      }, this.#dotDuration * WORD_TIMEOUT_FACTOR);
    }, this.#dotDuration * CHAR_TIMEOUT_FACTOR);
  }

  /**
   * Принудительно завершить текущий символ (например, при Submit).
   * @returns Расшифрованный символ или `null`, если строка не распознана.
   */
  flush(): string | null {
    this.#clearTimers();
    return this.#completeChar();
  }

  /**
   * Полный сброс состояния декодера.
   */
  reset(): void {
    this.#clearTimers();
    this.#accumulated = "";
    this.#pressStartMs = null;
  }

  // ── Приватные методы ───────────────────────────────────────────────────────

  /**
   * Определяет, является ли нажатие точкой или тире.
   *
   * Допуски (пересчитываются динамически при каждом вызове):
   *   Точка: 1 мс … dotDuration × 1.3
   *   Тире:  dotDuration × 1.5 и выше
   */
  #classify(durationMs: number): MorseSymbol {
    if (durationMs <= this.#dotDuration * DOT_MAX_FACTOR) {
      return ".";
    }
    if (durationMs >= this.#dotDuration * DASH_MIN_FACTOR) {
      return "-";
    }
    // Серая зона (1.3–1.5×): ближе к точке — считаем точкой
    return ".";
  }

  #completeChar(): string | null {
    const morse = this.#accumulated;
    this.#accumulated = "";

    if (!morse) return null;

    const char = this.#reverseMap[morse]; // string | undefined
    if (char === undefined) return null;

    this.#onChar?.(char);
    return char;
  }

  #clearTimers(): void {
    if (this.#charTimer !== null) {
      clearTimeout(this.#charTimer);
      this.#charTimer = null;
    }
    if (this.#wordTimer !== null) {
      clearTimeout(this.#wordTimer);
      this.#wordTimer = null;
    }
  }
}
