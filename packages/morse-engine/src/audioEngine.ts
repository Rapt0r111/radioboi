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
  | "wrong"
  | "targetLock"
  | "reloadReady";

type ToneLayer = {
  frequencyHz: number;
  endFrequencyHz?: number;
  gain: number;
  startOffsetS: number;
  durationS: number;
  attackS?: number;
  releaseS?: number;
  type?: OscillatorType;
};

type NoiseLayer = {
  gain: number;
  startOffsetS: number;
  durationS: number;
  attackS?: number;
  releaseS?: number;
  filterFrequencyHz?: number;
  endFilterFrequencyHz?: number;
  filterQ?: number;
  filterType?: BiquadFilterType;
  playbackRate?: number;
};

type BattleEffectPreset = {
  tones?: ToneLayer[];
  noises?: NoiseLayer[];
};

const BATTLE_EFFECTS: Record<BattleSoundEffect, BattleEffectPreset> = {
  missileLaunch: {
    tones: [
      {
        type: "sawtooth",
        frequencyHz: 95,
        endFrequencyHz: 740,
        gain: 0.2,
        startOffsetS: 0,
        durationS: 0.42,
        releaseS: 0.055,
      },
      {
        type: "triangle",
        frequencyHz: 42,
        endFrequencyHz: 86,
        gain: 0.13,
        startOffsetS: 0,
        durationS: 0.34,
        releaseS: 0.09,
      },
      {
        type: "sine",
        frequencyHz: 1280,
        endFrequencyHz: 1540,
        gain: 0.08,
        startOffsetS: 0.28,
        durationS: 0.08,
        releaseS: 0.014,
      },
    ],
    noises: [
      {
        gain: 0.18,
        startOffsetS: 0,
        durationS: 0.38,
        releaseS: 0.08,
        filterType: "bandpass",
        filterFrequencyHz: 820,
        endFilterFrequencyHz: 2100,
        filterQ: 1.15,
        playbackRate: 1.25,
      },
    ],
  },
  incomingMissile: {
    tones: [
      { type: "sine", frequencyHz: 720, gain: 0.16, startOffsetS: 0, durationS: 0.075 },
      { type: "sine", frequencyHz: 980, gain: 0.15, startOffsetS: 0.13, durationS: 0.075 },
      { type: "sine", frequencyHz: 1220, gain: 0.14, startOffsetS: 0.26, durationS: 0.075 },
      {
        type: "triangle",
        frequencyHz: 360,
        endFrequencyHz: 780,
        gain: 0.07,
        startOffsetS: 0,
        durationS: 0.38,
        releaseS: 0.06,
      },
    ],
  },
  hit: {
    tones: [
      {
        type: "triangle",
        frequencyHz: 210,
        endFrequencyHz: 54,
        gain: 0.28,
        startOffsetS: 0,
        durationS: 0.24,
        attackS: 0.0015,
        releaseS: 0.08,
      },
      {
        type: "square",
        frequencyHz: 680,
        endFrequencyHz: 240,
        gain: 0.08,
        startOffsetS: 0.02,
        durationS: 0.11,
        attackS: 0.001,
        releaseS: 0.025,
      },
    ],
    noises: [
      {
        gain: 0.26,
        startOffsetS: 0,
        durationS: 0.2,
        attackS: 0.001,
        releaseS: 0.09,
        filterType: "lowpass",
        filterFrequencyHz: 2300,
        endFilterFrequencyHz: 520,
        filterQ: 0.8,
      },
      {
        gain: 0.08,
        startOffsetS: 0.045,
        durationS: 0.12,
        releaseS: 0.04,
        filterType: "highpass",
        filterFrequencyHz: 2600,
        filterQ: 0.7,
        playbackRate: 1.7,
      },
    ],
  },
  miss: {
    tones: [
      {
        type: "sine",
        frequencyHz: 210,
        endFrequencyHz: 118,
        gain: 0.11,
        startOffsetS: 0.03,
        durationS: 0.18,
        releaseS: 0.055,
      },
      {
        type: "triangle",
        frequencyHz: 135,
        endFrequencyHz: 70,
        gain: 0.13,
        startOffsetS: 0.17,
        durationS: 0.24,
        releaseS: 0.08,
      },
      { type: "sine", frequencyHz: 78, gain: 0.08, startOffsetS: 0.38, durationS: 0.1 },
    ],
    noises: [
      {
        gain: 0.2,
        startOffsetS: 0,
        durationS: 0.3,
        attackS: 0.002,
        releaseS: 0.12,
        filterType: "bandpass",
        filterFrequencyHz: 540,
        endFilterFrequencyHz: 170,
        filterQ: 1.7,
        playbackRate: 0.85,
      },
    ],
  },
  sunk: {
    tones: [
      {
        type: "triangle",
        frequencyHz: 120,
        endFrequencyHz: 36,
        gain: 0.3,
        startOffsetS: 0,
        durationS: 0.72,
        attackS: 0.003,
        releaseS: 0.15,
      },
      {
        type: "sine",
        frequencyHz: 420,
        endFrequencyHz: 155,
        gain: 0.12,
        startOffsetS: 0.12,
        durationS: 0.54,
        releaseS: 0.12,
      },
      {
        type: "sawtooth",
        frequencyHz: 76,
        endFrequencyHz: 44,
        gain: 0.1,
        startOffsetS: 0.28,
        durationS: 0.64,
        releaseS: 0.16,
      },
      {
        type: "sine",
        frequencyHz: 220,
        endFrequencyHz: 132,
        gain: 0.07,
        startOffsetS: 0.72,
        durationS: 0.24,
        releaseS: 0.09,
      },
    ],
    noises: [
      {
        gain: 0.3,
        startOffsetS: 0,
        durationS: 0.34,
        attackS: 0.001,
        releaseS: 0.13,
        filterType: "lowpass",
        filterFrequencyHz: 1500,
        endFilterFrequencyHz: 280,
        filterQ: 0.8,
        playbackRate: 0.75,
      },
      {
        gain: 0.15,
        startOffsetS: 0.34,
        durationS: 0.68,
        releaseS: 0.2,
        filterType: "bandpass",
        filterFrequencyHz: 260,
        endFilterFrequencyHz: 120,
        filterQ: 1.4,
        playbackRate: 0.55,
      },
    ],
  },
  intercept: {
    tones: [
      { type: "square", frequencyHz: 1120, gain: 0.12, startOffsetS: 0, durationS: 0.045 },
      { type: "square", frequencyHz: 1480, gain: 0.11, startOffsetS: 0.06, durationS: 0.045 },
      {
        type: "triangle",
        frequencyHz: 780,
        endFrequencyHz: 260,
        gain: 0.1,
        startOffsetS: 0.11,
        durationS: 0.14,
        releaseS: 0.04,
      },
    ],
    noises: [
      {
        gain: 0.12,
        startOffsetS: 0.04,
        durationS: 0.12,
        releaseS: 0.035,
        filterType: "highpass",
        filterFrequencyHz: 1800,
        filterQ: 0.6,
        playbackRate: 1.9,
      },
    ],
  },
  wrong: {
    tones: [
      {
        type: "sawtooth",
        frequencyHz: 185,
        endFrequencyHz: 150,
        gain: 0.11,
        startOffsetS: 0,
        durationS: 0.1,
        releaseS: 0.025,
      },
      {
        type: "sawtooth",
        frequencyHz: 150,
        endFrequencyHz: 115,
        gain: 0.11,
        startOffsetS: 0.12,
        durationS: 0.13,
        releaseS: 0.035,
      },
    ],
  },
  targetLock: {
    tones: [
      { type: "sine", frequencyHz: 520, gain: 0.07, startOffsetS: 0, durationS: 0.05 },
      { type: "sine", frequencyHz: 780, gain: 0.08, startOffsetS: 0.06, durationS: 0.055 },
      { type: "sine", frequencyHz: 1040, gain: 0.09, startOffsetS: 0.125, durationS: 0.07 },
    ],
  },
  reloadReady: {
    tones: [
      {
        type: "triangle",
        frequencyHz: 300,
        endFrequencyHz: 620,
        gain: 0.08,
        startOffsetS: 0,
        durationS: 0.11,
        releaseS: 0.025,
      },
      { type: "sine", frequencyHz: 980, gain: 0.08, startOffsetS: 0.12, durationS: 0.065 },
    ],
  },
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

  #noiseBuffer: AudioBuffer | null = null;
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
    const preset = BATTLE_EFFECTS[effect];
    const now = this.#ctx.currentTime;

    for (const tone of preset.tones ?? []) {
      this.#playToneLayer(tone, now);
    }
    for (const noise of preset.noises ?? []) {
      this.#playNoiseLayer(noise, now);
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

  #playToneLayer(voice: ToneLayer, baseS: number): void {
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

  #playNoiseLayer(layer: NoiseLayer, baseS: number): void {
    const atS = baseS + layer.startOffsetS;
    const durationS = Math.max(0.02, layer.durationS);
    const endS = atS + durationS;
    const attackS = layer.attackS ?? 0.003;
    const releaseS = Math.min(durationS * 0.75, layer.releaseS ?? 0.06);
    const releaseStartS = Math.max(atS + attackS, endS - releaseS);

    const source = this.#ctx.createBufferSource();
    const filter = this.#ctx.createBiquadFilter();
    const gainNode = this.#ctx.createGain();
    const gain = gainNode.gain;

    source.buffer = this.#getNoiseBuffer();
    source.playbackRate.setValueAtTime(layer.playbackRate ?? 1, atS);

    filter.type = layer.filterType ?? "bandpass";
    filter.frequency.setValueAtTime(layer.filterFrequencyHz ?? 900, atS);
    filter.Q.value = layer.filterQ ?? 1;
    if (layer.endFilterFrequencyHz !== undefined) {
      filter.frequency.linearRampToValueAtTime(layer.endFilterFrequencyHz, endS);
    }

    gain.cancelScheduledValues(atS);
    gain.setValueAtTime(0, atS);
    gain.linearRampToValueAtTime(layer.gain, atS + attackS);
    gain.setValueAtTime(layer.gain, releaseStartS);
    gain.linearRampToValueAtTime(0, endS);

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.#masterGain);
    this.#battleEffectGains.add(gainNode);

    source.start(atS, 0, durationS);
    source.stop(endS + 0.02);

    setTimeout(
      () => {
        try {
          source.disconnect();
          filter.disconnect();
          gainNode.disconnect();
        } catch {
          // Nodes can already be detached or the context can be closed.
        }
        this.#battleEffectGains.delete(gainNode);
      },
      Math.max(0, (endS + 0.08 - this.#ctx.currentTime) * 1000),
    );
  }

  #getNoiseBuffer(): AudioBuffer {
    if (this.#noiseBuffer) return this.#noiseBuffer;

    const length = Math.max(1, Math.floor(this.#ctx.sampleRate * 1.2));
    const buffer = this.#ctx.createBuffer(1, length, this.#ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    let seed = 0x2f6e2b1;

    for (let index = 0; index < channel.length; index++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const white = seed / 0xffffffff;
      const brownish = (white * 2 - 1) * (1 - index / channel.length) * 0.92;
      channel[index] = brownish;
    }

    this.#noiseBuffer = buffer;
    return buffer;
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
