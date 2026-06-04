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
// Every ultra-short keydown gets an audible one-shot dot this long.
const TAP_PULSE_S = 0.055;
// Enough independent voices for rapid tapping without cancelling previous dots.
const TAP_PULSE_VOICES = 8;
// Only for playSequence stability. Manual keying never uses lookahead.
const SEQUENCE_LOOKAHEAD_S = 0.004;

// -- Types --------------------------------------------------------------------

export type MorseEngineOptions = {
  frequency?: number;
  volume?: number;
};

export type BattleSoundEffect =
  | "missileLaunch"
  | "incomingMissile"
  | "hit"
  | "miss"
  | "sunk"
  | "intercept"
  | "wrong";

type BattleEffectVoice = {
  frequencyHz: number;
  endFrequencyHz?: number;
  gain: number;
  startOffsetS: number;
  durationS: number;
  attackS?: number;
  releaseS?: number;
  type?: OscillatorType;
};

const BATTLE_EFFECTS: Record<BattleSoundEffect, BattleEffectVoice[]> = {
  missileLaunch: [
    { type: "triangle", frequencyHz: 180, endFrequencyHz: 760, gain: 0.18, startOffsetS: 0, durationS: 0.34, releaseS: 0.045 },
    { type: "sawtooth", frequencyHz: 92, endFrequencyHz: 150, gain: 0.08, startOffsetS: 0, durationS: 0.2, releaseS: 0.05 },
    { type: "sine", frequencyHz: 940, endFrequencyHz: 1180, gain: 0.12, startOffsetS: 0.2, durationS: 0.075, releaseS: 0.018 },
  ],
  incomingMissile: [
    { type: "sine", frequencyHz: 700, gain: 0.16, startOffsetS: 0, durationS: 0.08, releaseS: 0.018 },
    { type: "sine", frequencyHz: 930, gain: 0.14, startOffsetS: 0.14, durationS: 0.08, releaseS: 0.018 },
    { type: "triangle", frequencyHz: 260, endFrequencyHz: 420, gain: 0.08, startOffsetS: 0, durationS: 0.32, releaseS: 0.05 },
  ],
  hit: [
    { type: "triangle", frequencyHz: 230, endFrequencyHz: 88, gain: 0.24, startOffsetS: 0, durationS: 0.18, attackS: 0.002, releaseS: 0.055 },
    { type: "square", frequencyHz: 620, endFrequencyHz: 280, gain: 0.1, startOffsetS: 0.015, durationS: 0.12, attackS: 0.002, releaseS: 0.03 },
    { type: "sine", frequencyHz: 1040, gain: 0.07, startOffsetS: 0.055, durationS: 0.055, releaseS: 0.015 },
  ],
  miss: [
    { type: "sine", frequencyHz: 220, endFrequencyHz: 125, gain: 0.12, startOffsetS: 0, durationS: 0.16, releaseS: 0.04 },
    { type: "triangle", frequencyHz: 135, endFrequencyHz: 76, gain: 0.14, startOffsetS: 0.095, durationS: 0.22, releaseS: 0.055 },
    { type: "sine", frequencyHz: 92, gain: 0.08, startOffsetS: 0.25, durationS: 0.09, releaseS: 0.03 },
  ],
  sunk: [
    { type: "triangle", frequencyHz: 165, endFrequencyHz: 52, gain: 0.27, startOffsetS: 0, durationS: 0.58, attackS: 0.004, releaseS: 0.11 },
    { type: "sawtooth", frequencyHz: 82, endFrequencyHz: 48, gain: 0.13, startOffsetS: 0.12, durationS: 0.42, releaseS: 0.1 },
    { type: "sine", frequencyHz: 620, endFrequencyHz: 240, gain: 0.11, startOffsetS: 0.06, durationS: 0.34, releaseS: 0.08 },
    { type: "sine", frequencyHz: 120, endFrequencyHz: 72, gain: 0.08, startOffsetS: 0.47, durationS: 0.2, releaseS: 0.06 },
  ],
  intercept: [
    { type: "square", frequencyHz: 980, gain: 0.11, startOffsetS: 0, durationS: 0.055, releaseS: 0.012 },
    { type: "square", frequencyHz: 1240, gain: 0.1, startOffsetS: 0.075, durationS: 0.055, releaseS: 0.012 },
    { type: "triangle", frequencyHz: 520, endFrequencyHz: 260, gain: 0.1, startOffsetS: 0.13, durationS: 0.12, releaseS: 0.035 },
  ],
  wrong: [
    { type: "sawtooth", frequencyHz: 185, endFrequencyHz: 150, gain: 0.1, startOffsetS: 0, durationS: 0.095, releaseS: 0.025 },
    { type: "sawtooth", frequencyHz: 155, endFrequencyHz: 125, gain: 0.1, startOffsetS: 0.12, durationS: 0.12, releaseS: 0.035 },
  ],
};

// -- Class --------------------------------------------------------------------

export class MorseEngine {
  readonly #ctx: AudioContext;
  readonly #oscillator: OscillatorNode;
  readonly #filter: BiquadFilterNode;
  readonly #envelopeGain: GainNode;
  readonly #effectGain: GainNode;
  readonly #tapPulseGains: GainNode[];
  readonly #masterGain: GainNode;
  readonly #battleEffectGains = new Set<GainNode>();

  #isPlaying: boolean = false;
  #playbackId: number = 0;
  #unitMs: number = DEFAULT_UNIT_MS;
  #resolvePlayback: (() => void) | null = null;
  #manualToneId: number = 0;
  #manualToneRequested: boolean = false;
  #manualToneStartedAtS: number | null = null;
  #nextTapPulseVoice: number = 0;
  #resumePromise: Promise<void> | null = null;

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
    this.#tapPulseGains = Array.from({ length: TAP_PULSE_VOICES }, () => this.#ctx.createGain());
    this.#masterGain = this.#ctx.createGain();

    this.#oscillator.type = "sine";
    this.#oscillator.frequency.value = frequency;

    this.#filter.type = "bandpass";
    this.#filter.frequency.value = frequency;
    this.#filter.Q.value = DEFAULT_FILTER_Q;

    this.#envelopeGain.gain.value = 0;
    this.#effectGain.gain.value = 0;
    for (const tapGain of this.#tapPulseGains) {
      tapGain.gain.value = 0;
    }
    this.#masterGain.gain.value = Math.max(0, Math.min(1, volume));

    this.#oscillator.connect(this.#filter);
    this.#filter.connect(this.#envelopeGain);
    this.#filter.connect(this.#effectGain);
    this.#envelopeGain.connect(this.#masterGain);
    this.#effectGain.connect(this.#masterGain);
    for (const tapGain of this.#tapPulseGains) {
      this.#filter.connect(tapGain);
      tapGain.connect(this.#masterGain);
    }
    this.#masterGain.connect(this.#ctx.destination);

    this.#oscillator.start();
  }

  // -- AudioContext -----------------------------------------------------------

  async resume(): Promise<void> {
    if (this.#ctx.state !== "suspended") return;

    this.#resumePromise ??= this.#ctx.resume().finally(() => {
      this.#resumePromise = null;
    });

    await this.#resumePromise;
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

  playBattleEffect(effect: BattleSoundEffect): void {
    const voices = BATTLE_EFFECTS[effect];
    const now = this.#ctx.currentTime;

    for (const voice of voices) {
      this.#playEffectVoice(voice, now);
    }

    if (this.#ctx.state !== "running") {
      void this.resume().catch(() => {
        // The effect was already scheduled for the next successful unlock.
      });
    }
  }

  // -- Manual telegraph key ---------------------------------------------------

  startTone(): void {
    const id = ++this.#manualToneId;
    const now = this.#ctx.currentTime;

    this.#manualToneRequested = true;
    this.#manualToneStartedAtS = now;
    this.#isPlaying = true;

    // Critical for Morse: do not wait for resume() and do not add lookahead.
    // The held tone starts immediately; the one-shot pulse guarantees that an
    // ultra-short tap is audible even if keyup follows almost instantly.
    this.#forceManualToneOn(now);
    this.#playTapPulse(now);

    if (this.#ctx.state !== "running") {
      void this.resume()
        .then(() => {
          if (this.#manualToneId !== id || !this.#manualToneRequested) return;
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

    const now = this.#ctx.currentTime;
    this.#silenceGain(this.#envelopeGain.gain, now);
    this.#silenceGain(this.#effectGain.gain, now);
    for (const tapGain of this.#tapPulseGains) {
      this.#silenceGain(tapGain.gain, now);
    }
    for (const effectGain of this.#battleEffectGains) {
      this.#silenceGain(effectGain.gain, now);
    }
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
    this.#manualToneStartedAtS = null;

    const gain = this.#envelopeGain.gain;
    const now = this.#ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.setTargetAtTime(0, now, MANUAL_RELEASE_S);
  }

  #playTapPulse(atS: number): void {
    const tapGain = this.#tapPulseGains[this.#nextTapPulseVoice % this.#tapPulseGains.length];
    this.#nextTapPulseVoice++;

    if (!tapGain) return;

    const gain = tapGain.gain;
    const releaseAt = atS + TAP_PULSE_S;

    gain.cancelScheduledValues(atS);
    gain.setValueAtTime(0, atS);
    gain.setValueAtTime(1, atS);
    gain.setValueAtTime(1, releaseAt);
    gain.setTargetAtTime(0, releaseAt, MANUAL_RELEASE_S);
  }

  #silenceGain(gain: AudioParam, atS: number): void {
    gain.cancelScheduledValues(atS);
    gain.setTargetAtTime(0, atS, MANUAL_RELEASE_S);
  }

  #playEffectVoice(voice: BattleEffectVoice, baseS: number): void {
    const atS = baseS + voice.startOffsetS;
    const durationS = Math.max(0.02, voice.durationS);
    const endS = atS + durationS;
    const attackS = voice.attackS ?? 0.004;
    const releaseS = Math.min(durationS * 0.7, voice.releaseS ?? 0.03);
    const releaseStartS = Math.max(atS + attackS, endS - releaseS);

    const oscillator = this.#ctx.createOscillator();
    const gainNode = this.#ctx.createGain();
    const gain = gainNode.gain;

    oscillator.type = voice.type ?? "sine";
    oscillator.frequency.setValueAtTime(voice.frequencyHz, atS);
    if (voice.endFrequencyHz !== undefined) {
      oscillator.frequency.linearRampToValueAtTime(voice.endFrequencyHz, endS);
    }

    gain.cancelScheduledValues(atS);
    gain.setValueAtTime(0, atS);
    gain.linearRampToValueAtTime(voice.gain, atS + attackS);
    gain.setValueAtTime(voice.gain, releaseStartS);
    gain.linearRampToValueAtTime(0, endS);

    oscillator.connect(gainNode);
    gainNode.connect(this.#masterGain);
    this.#battleEffectGains.add(gainNode);

    oscillator.start(atS);
    oscillator.stop(endS + 0.02);

    setTimeout(
      () => {
        try {
          oscillator.disconnect();
          gainNode.disconnect();
        } catch {
          // Nodes can already be detached or the context can be closed.
        }
        this.#battleEffectGains.delete(gainNode);
      },
      Math.max(0, (endS + 0.08 - this.#ctx.currentTime) * 1000),
    );
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
