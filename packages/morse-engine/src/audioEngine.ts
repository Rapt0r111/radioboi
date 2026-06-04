// packages/morse-engine/src/audioEngine.ts
// Native Web Audio engine for Morse playback and manual key feedback.

// -- Safari webkitAudioContext shim ------------------------------------------

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

function createAudioContext(): AudioContext {
  const Ctx = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctx) {
    throw new Error("MorseEngine: Web Audio API is not supported by this browser.");
  }
  return new Ctx();
}

// -- Constants ----------------------------------------------------------------

const DEFAULT_FREQUENCY_HZ = 600;
const DEFAULT_FILTER_Q = 10;
const DEFAULT_MASTER_VOLUME = 0.8;
// 60 ms = 20 WPM by the PARIS standard; matches the UI default.
const DEFAULT_UNIT_MS = 60;

const SEQUENCE_ATTACK_S = 0.004;
const SEQUENCE_RELEASE_S = 0.004;
const MANUAL_RELEASE_S = 0.003;
// Even an ultra-short tap must remain audible as a Morse dot.
const MIN_MANUAL_TONE_S = 0.055;
// Only for playSequence stability. Manual keying never uses lookahead.
const SEQUENCE_LOOKAHEAD_S = 0.004;

// -- Types --------------------------------------------------------------------

export type MorseEngineOptions = {
  frequency?: number;
  volume?: number;
};

// -- Class --------------------------------------------------------------------

export class MorseEngine {
  readonly #ctx: AudioContext;
  readonly #oscillator: OscillatorNode;
  readonly #filter: BiquadFilterNode;
  readonly #envelopeGain: GainNode;
  readonly #effectGain: GainNode;
  readonly #masterGain: GainNode;

  #isPlaying: boolean = false;
  #playbackId: number = 0;
  #unitMs: number = DEFAULT_UNIT_MS;
  #resolvePlayback: (() => void) | null = null;
  #manualToneId: number = 0;
  #manualToneRequested: boolean = false;
  #manualToneStartedAtS: number | null = null;

  constructor(options: MorseEngineOptions = {}) {
    if (typeof window === "undefined") {
      throw new Error(
        "MorseEngine: can only be instantiated in a browser environment. " +
          "Use dynamic import or wrap in useEffect.",
      );
    }

    const frequency = options.frequency ?? DEFAULT_FREQUENCY_HZ;
    const volume = options.volume ?? DEFAULT_MASTER_VOLUME;

    this.#ctx = createAudioContext();

    this.#oscillator = this.#ctx.createOscillator();
    this.#filter = this.#ctx.createBiquadFilter();
    this.#envelopeGain = this.#ctx.createGain();
    this.#effectGain = this.#ctx.createGain();
    this.#masterGain = this.#ctx.createGain();

    this.#oscillator.type = "sine";
    this.#oscillator.frequency.value = frequency;

    this.#filter.type = "bandpass";
    this.#filter.frequency.value = frequency;
    this.#filter.Q.value = DEFAULT_FILTER_Q;

    this.#envelopeGain.gain.value = 0;
    this.#effectGain.gain.value = 0;
    this.#masterGain.gain.value = Math.max(0, Math.min(1, volume));

    this.#oscillator.connect(this.#filter);
    this.#filter.connect(this.#envelopeGain);
    this.#filter.connect(this.#effectGain);
    this.#envelopeGain.connect(this.#masterGain);
    this.#effectGain.connect(this.#masterGain);
    this.#masterGain.connect(this.#ctx.destination);

    this.#oscillator.start();
  }

  // -- AudioContext -----------------------------------------------------------

  async resume(): Promise<void> {
    if (this.#ctx.state === "suspended") {
      await this.#ctx.resume();
    }
  }

  get state(): AudioContextState {
    return this.#ctx.state;
  }

  // -- Settings ---------------------------------------------------------------

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

  // -- Scheduled sequence playback ------------------------------------------

  async playSequence(sequence: number[], unitMs?: number): Promise<void> {
    const resolvedUnitMs = unitMs ?? this.#unitMs;
    await this.resume();

    this.#isPlaying = true;
    const id = ++this.#playbackId;
    const unitS = resolvedUnitMs / 1000;
    const endTimeS = this.#scheduleSequence(this.#effectGain.gain, sequence, unitS);

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

  async playEffect(sequence: number[], unitMs?: number): Promise<void> {
    return this.playSequence(sequence, unitMs);
  }

  // -- Manual telegraph key ---------------------------------------------------

  startTone(): void {
    const id = ++this.#manualToneId;
    this.#manualToneRequested = true;
    this.#manualToneStartedAtS = this.#ctx.currentTime;
    this.#playbackId++;
    this.#isPlaying = true;
    this.#resolvePlayback?.();
    this.#resolvePlayback = null;

    // Critical for Morse: do not wait for resume() and do not add lookahead.
    // Queue the gain change synchronously inside the same user-gesture callback.
    this.#forceManualToneOn(this.#ctx.currentTime);

    if (this.#ctx.state !== "running") {
      void this.resume()
        .then(() => {
          if (this.#manualToneId !== id || !this.#manualToneRequested) return;
          // If the context has just unlocked and the key is still held, pin the
          // manual gain to 1 at the newly-current context time too.
          this.#forceManualToneOn(this.#ctx.currentTime);
        })
        .catch(() => {
          if (this.#manualToneId === id) this.stop();
        });
    }
  }

  stopTone(): void {
    if (!this.#manualToneRequested && this.#manualToneStartedAtS === null) return;
    this.#manualToneRequested = false;
    this.#releaseManualTone();
  }

  stop(): void {
    this.#playbackId++;
    this.#isPlaying = false;
    this.#manualToneRequested = false;
    this.#manualToneStartedAtS = null;
    this.#resolvePlayback?.();
    this.#resolvePlayback = null;

    const gain = this.#envelopeGain.gain;
    const now = this.#ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(0, now, MANUAL_RELEASE_S);
  }

  async close(): Promise<void> {
    this.stop();
    try {
      this.#oscillator.stop();
    } catch {
      // Oscillator can already be stopped.
    }
    await this.#ctx.close();
  }

  // -- Private ----------------------------------------------------------------

  #forceManualToneOn(atS: number): void {
    const gain = this.#envelopeGain.gain;
    gain.cancelScheduledValues(atS);
    gain.setValueAtTime(1, atS);
  }

  #releaseManualTone(): void {
    this.#isPlaying = false;
    this.#resolvePlayback?.();
    this.#resolvePlayback = null;

    const gain = this.#envelopeGain.gain;
    const now = this.#ctx.currentTime;
    const startedAt = this.#manualToneStartedAtS ?? now;
    const releaseAt = Math.max(now, startedAt + MIN_MANUAL_TONE_S);

    this.#manualToneStartedAtS = null;

    gain.cancelScheduledValues(now);
    // If press/release both happen before resume() resolves, this queued
    // automation still produces an immediate audible pulse after unlock.
    gain.setValueAtTime(1, now);
    if (releaseAt > now) {
      gain.setValueAtTime(1, releaseAt);
    }
    gain.setTargetAtTime(0, releaseAt, MANUAL_RELEASE_S);
  }

  #scheduleSequence(gain: AudioParam, sequence: number[], unitS: number): number {
    const now = this.#ctx.currentTime;

    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0, now);

    let t = now + SEQUENCE_LOOKAHEAD_S;

    for (const dur of sequence) {
      if (dur > 0) {
        const soundS = dur * unitS;
        const attackEnd = t + SEQUENCE_ATTACK_S;
        const releaseStart = t + soundS - SEQUENCE_RELEASE_S;

        gain.setValueAtTime(0, t);
        gain.linearRampToValueAtTime(1, attackEnd);

        if (releaseStart > attackEnd) {
          gain.setValueAtTime(1, releaseStart);
          gain.linearRampToValueAtTime(0, t + soundS);
        } else {
          gain.setTargetAtTime(0, attackEnd, MANUAL_RELEASE_S);
        }

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
