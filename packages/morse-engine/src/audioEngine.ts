// packages/morse-engine/src/audioEngine.ts
// Аудио-движок на нативном Web Audio API.
//
// FIX (LOW): Добавлена поддержка Safari webkitAudioContext.
// Safari до версии 14.1 использует prefixed AudioContext.
// Без этого fix MorseEngine падает с "AudioContext is not defined" на iOS Safari.

// ── Safari webkitAudioContext shim ────────────────────────────────────────────

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

function createAudioContext(): AudioContext {
  // Стандартный AudioContext доступен в Chrome, Firefox, Safari 14.1+
  // webkitAudioContext — Safari < 14.1, старые iOS
  const Ctx = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctx) {
    throw new Error(
      "MorseEngine: Web Audio API не поддерживается этим браузером.",
    );
  }
  return new Ctx();
}

// ── Константы ─────────────────────────────────────────────────────────────────

const DEFAULT_FREQUENCY_HZ = 600;
const DEFAULT_FILTER_Q = 10;
const DEFAULT_MASTER_VOLUME = 0.8;
// FIX: DEFAULT_UNIT_MS снижен с 100 до 60 (= 20 WPM стандарт PARIS).
// Это согласуется с WPM_DEFAULT=20 в GameControls и unitMs=60 в MorseTelegraph,
// устраняя рассинхронизацию скорости воспроизведения и отображаемого WPM.
const DEFAULT_UNIT_MS = 60;

const ATTACK_S = 0.005;
const RELEASE_S = 0.005;
const SCHEDULE_OFFSET_S = 0.025;

// ── Типы ──────────────────────────────────────────────────────────────────────

export type MorseEngineOptions = {
  frequency?: number;
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
  #playbackId: number = 0;
  #unitMs: number = DEFAULT_UNIT_MS;
  #resolvePlayback: (() => void) | null = null;

  constructor(options: MorseEngineOptions = {}) {
    // SSR guard — AudioContext недоступен вне браузера
    if (typeof window === "undefined") {
      throw new Error(
        "MorseEngine: can only be instantiated in a browser environment. " +
          "Use dynamic import or wrap in useEffect.",
      );
    }

    const frequency = options.frequency ?? DEFAULT_FREQUENCY_HZ;
    const volume = options.volume ?? DEFAULT_MASTER_VOLUME;

    // FIX: используем createAudioContext() с webkitAudioContext fallback
    this.#ctx = createAudioContext();

    this.#oscillator = this.#ctx.createOscillator();
    this.#filter = this.#ctx.createBiquadFilter();
    this.#envelopeGain = this.#ctx.createGain();
    this.#masterGain = this.#ctx.createGain();

    this.#oscillator.type = "sine";
    this.#oscillator.frequency.value = frequency;

    this.#filter.type = "bandpass";
    this.#filter.frequency.value = frequency;
    this.#filter.Q.value = DEFAULT_FILTER_Q;

    this.#envelopeGain.gain.value = 0;
    this.#masterGain.gain.value = Math.max(0, Math.min(1, volume));

    this.#oscillator.connect(this.#filter);
    this.#filter.connect(this.#envelopeGain);
    this.#envelopeGain.connect(this.#masterGain);
    this.#masterGain.connect(this.#ctx.destination);

    this.#oscillator.start();
  }

  // ── Управление контекстом ─────────────────────────────────────────────────

  async resume(): Promise<void> {
    if (this.#ctx.state === "suspended") {
      await this.#ctx.resume();
    }
  }

  get state(): AudioContextState {
    return this.#ctx.state;
  }

  // ── Настройки ─────────────────────────────────────────────────────────────

  setFrequency(hz: number): void {
    this.#oscillator.frequency.value = hz;
    this.#filter.frequency.value = hz;
  }

  setVolume(volume: number): void {
    this.#masterGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, volume)),
      this.#ctx.currentTime,
      0.01,
    );
  }

  setSpeed(unitMs: number): void {
    this.#unitMs = Math.max(20, unitMs);
  }

  get currentUnitMs(): number {
    return this.#unitMs;
  }

  get isPlaying(): boolean {
    return this.#isPlaying;
  }

  // ── Воспроизведение ───────────────────────────────────────────────────────

  async playSequence(sequence: number[], unitMs?: number): Promise<void> {
    const resolvedUnitMs = unitMs ?? this.#unitMs;
    await this.resume();
    this.stop();

    this.#isPlaying = true;
    const id = ++this.#playbackId;
    const unitS = resolvedUnitMs / 1000;
    const endTimeS = this.#scheduleSequence(sequence, unitS);

    return new Promise<void>((resolve) => {
      this.#resolvePlayback = resolve;
      const remainingMs = (endTimeS - this.#ctx.currentTime) * 1000;

      setTimeout(
        () => {
          if (this.#playbackId === id) {
            this.#isPlaying = false;
          }
          if (this.#resolvePlayback === resolve) {
            this.#resolvePlayback = null;
            resolve();
          }
        },
        Math.max(0, remainingMs),
      );
    });
  }

  stop(): void {
    this.#playbackId++;
    this.#isPlaying = false;
    this.#resolvePlayback?.();
    this.#resolvePlayback = null;

    const gain = this.#envelopeGain.gain;
    const now = this.#ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(0, now, 0.003);
  }

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

  #scheduleSequence(sequence: number[], unitS: number): number {
    const gain = this.#envelopeGain.gain;
    const now = this.#ctx.currentTime;

    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0, now);

    let t = now + SCHEDULE_OFFSET_S;

    for (const dur of sequence) {
      if (dur > 0) {
        const soundS = dur * unitS;
        const attackEnd = t + ATTACK_S;
        const releaseStart = t + soundS - RELEASE_S;

        gain.setValueAtTime(0, t);
        gain.linearRampToValueAtTime(1, attackEnd);

        if (releaseStart > attackEnd) {
          gain.setValueAtTime(1, releaseStart);
        }

        gain.linearRampToValueAtTime(0, t + soundS);
        t += soundS;
      } else {
        const silenceS = Math.abs(dur) * unitS;
        gain.setValueAtTime(0, t);
        t += silenceS;
      }
    }

    return t;
  }
}