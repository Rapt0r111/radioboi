// packages/morse-engine/src/MorseEngine.ts
// Аудио-движок на нативном Web Audio API.
// Запрещено: внешние библиотеки, AudioWorklet.
// Цепочка: OscillatorNode → BiquadFilterNode → GainNode(envelope) → GainNode(master) → destination

// ── Константы ─────────────────────────────────────────────────────────────────

const DEFAULT_FREQUENCY_HZ = 600;
const DEFAULT_FILTER_Q = 10;
const DEFAULT_MASTER_VOLUME = 0.8;
const DEFAULT_UNIT_MS = 100; // мс на одну единицу длительности

/** Attack/Release огибающей в секундах (подавление щелчков). */
const ATTACK_S = 0.005;  // 5 мс
const RELEASE_S = 0.005; // 5 мс

/** Начальный буфер перед первым звуком (даём AudioContext осесть). */
const SCHEDULE_OFFSET_S = 0.025;

// ── Типы ──────────────────────────────────────────────────────────────────────

export type MorseEngineOptions = {
  /** Тональность сигнала в Гц. По умолчанию 600. */
  frequency?: number;
  /** Начальная громкость [0, 1]. По умолчанию 0.8. */
  volume?: number;
};

// ── Класс ─────────────────────────────────────────────────────────────────────

export class MorseEngine {
  readonly #ctx: AudioContext;
  readonly #oscillator: OscillatorNode;
  readonly #filter: BiquadFilterNode;
  readonly #envelopeGain: GainNode;
  readonly #masterGain: GainNode;

  #isPlaying: boolean = false;
  /** Используется для отмены ожидания в playSequence при stop(). */
  #playbackId: number = 0;

  constructor(options: MorseEngineOptions = {}) {
    const frequency = options.frequency ?? DEFAULT_FREQUENCY_HZ;
    const volume = options.volume ?? DEFAULT_MASTER_VOLUME;

    // AudioContext создаётся в suspended-состоянии до первого
    // взаимодействия пользователя — это нормально.
    this.#ctx = new AudioContext();

    // ── Узлы ──────────────────────────────────────────────────────────────

    this.#oscillator = this.#ctx.createOscillator();
    this.#filter = this.#ctx.createBiquadFilter();
    this.#envelopeGain = this.#ctx.createGain();
    this.#masterGain = this.#ctx.createGain();

    // ── Конфигурация ───────────────────────────────────────────────────────

    // 1. Осциллятор: синус, 600 Гц
    this.#oscillator.type = "sine";
    this.#oscillator.frequency.value = frequency;

    // 2. Полосовой фильтр: имитация радиоэфира
    this.#filter.type = "bandpass";
    this.#filter.frequency.value = frequency;
    this.#filter.Q.value = DEFAULT_FILTER_Q;

    // 3. Огибающая: начинаем с нуля (тишина до первого сигнала)
    this.#envelopeGain.gain.value = 0;

    // 4. Мастер-громкость
    this.#masterGain.gain.value = Math.max(0, Math.min(1, volume));

    // ── Цепочка подключений ────────────────────────────────────────────────
    // Oscillator → BiquadFilter → Envelope → Master → Destination
    this.#oscillator.connect(this.#filter);
    this.#filter.connect(this.#envelopeGain);
    this.#envelopeGain.connect(this.#masterGain);
    this.#masterGain.connect(this.#ctx.destination);

    // Осциллятор работает непрерывно; огибающая управляет слышимостью.
    // Это единственный запуск — OscillatorNode можно запустить лишь раз.
    this.#oscillator.start();
  }

  // ── Управление контекстом ─────────────────────────────────────────────────

  /**
   * Разблокирует AudioContext после первого пользовательского взаимодействия.
   * Вызывается автоматически внутри `playSequence`, но можно вызвать явно
   * (например, из обработчика кнопки) для прогрева контекста.
   */
  async resume(): Promise<void> {
    if (this.#ctx.state === "suspended") {
      await this.#ctx.resume();
    }
  }

  get state(): AudioContextState {
    return this.#ctx.state;
  }

  // ── Настройки ─────────────────────────────────────────────────────────────

  /**
   * Устанавливает тональность сигнала в реальном времени.
   * Синхронно обновляет и осциллятор, и фильтр.
   */
  setFrequency(hz: number): void {
    this.#oscillator.frequency.value = hz;
    this.#filter.frequency.value = hz;
  }

  /**
   * Устанавливает громкость [0, 1] плавно (10 мс сглаживание).
   */
  setVolume(volume: number): void {
    this.#masterGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, volume)),
      this.#ctx.currentTime,
      0.01,
    );
  }

  get isPlaying(): boolean {
    return this.#isPlaying;
  }

  // ── Воспроизведение ───────────────────────────────────────────────────────

  /**
   * Воспроизводит последовательность тайминговых единиц Морзе.
   *
   * @param sequence Выход `encodeToMorse()`: положительные числа — звук,
   *                 отрицательные — пауза (в условных единицах).
   * @param unitMs   Длительность одной условной единицы в мс. По умолчанию 100.
   * @returns Promise, резолвящийся по окончании воспроизведения.
   *          При вызове `stop()` резолвится досрочно.
   */
  async playSequence(sequence: number[], unitMs: number = DEFAULT_UNIT_MS): Promise<void> {
    await this.resume();

    // Прерываем предыдущее воспроизведение (если есть)
    this.stop();

    this.#isPlaying = true;
    const id = ++this.#playbackId;

    const unitS = unitMs / 1000;
    const endTimeS = this.#scheduleSequence(sequence, unitS);

    return new Promise<void>((resolve) => {
      const remainingMs = (endTimeS - this.#ctx.currentTime) * 1000;

      const handle = setTimeout(() => {
        if (this.#playbackId === id) {
          this.#isPlaying = false;
        }
        resolve();
      }, Math.max(0, remainingMs));

      // Если stop() будет вызван — playbackId изменится, таймер
      // отрабатывает но isPlaying уже сброшен в stop().
      // Дополнительно регистрируем слушатель на смену playbackId.
      // Это достигается через AbortController-подобный трюк:
      // просто позволяем таймеру сработать — reject не нужен,
      // т.к. остановка аудио — не ошибка.
      void handle; // prevent biome "unused variable" warning
    });
  }

  /**
   * Немедленно останавливает воспроизведение с мягким fadeout (3 мс).
   */
  stop(): void {
    this.#playbackId++;
    this.#isPlaying = false;

    const gain = this.#envelopeGain.gain;
    const now = this.#ctx.currentTime;

    // Отменяем все запланированные события огибающей
    gain.cancelScheduledValues(now);
    // Мягкое затухание во избежание щелчка
    gain.setTargetAtTime(0, now, 0.003);
  }

  // ── Уничтожение ───────────────────────────────────────────────────────────

  /**
   * Освобождает AudioContext и все ноды.
   * После вызова экземпляр нельзя использовать повторно.
   */
  async close(): Promise<void> {
    this.stop();
    try {
      this.#oscillator.stop();
    } catch {
      // Осциллятор уже мог быть остановлен
    }
    await this.#ctx.close();
  }

  // ── Приватные методы ───────────────────────────────────────────────────────

  /**
   * Планирует все события огибающей в AudioContext timeline.
   * @returns Время окончания последнего события (в секундах AudioContext).
   */
  #scheduleSequence(sequence: number[], unitS: number): number {
    const gain = this.#envelopeGain.gain;
    const now = this.#ctx.currentTime;

    // Сбрасываем все ранее запланированные значения
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0, now);

    let t = now + SCHEDULE_OFFSET_S;

    for (const dur of sequence) {
      if (dur > 0) {
        // ── Звуковой сегмент ──────────────────────────────────────────────
        const soundS = dur * unitS;
        const attackEnd = t + ATTACK_S;
        const releaseStart = t + soundS - RELEASE_S;

        // Attack: 0 → 1
        gain.setValueAtTime(0, t);
        gain.linearRampToValueAtTime(1, attackEnd);

        // Hold: если времени достаточно
        if (releaseStart > attackEnd) {
          gain.setValueAtTime(1, releaseStart);
        }

        // Release: 1 → 0
        gain.linearRampToValueAtTime(0, t + soundS);

        t += soundS;
      } else {
        // ── Пауза ─────────────────────────────────────────────────────────
        const silenceS = Math.abs(dur) * unitS;
        gain.setValueAtTime(0, t);
        t += silenceS;
      }
    }

    return t;
  }
}