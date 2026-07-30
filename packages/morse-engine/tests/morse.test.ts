import { describe, expect, test } from "bun:test";
import type { BattleSoundEffect } from "../src";
import { encodeToMorse, FuzzyDecoder, MORSE_ALPHABET, MORSE_REVERSE, MorseEngine } from "../src";

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

  test("keeps alphabet and reverse lookup in sync for supported symbols", () => {
    for (const [char, morse] of Object.entries(MORSE_ALPHABET)) {
      const decoded = MORSE_REVERSE[morse];
      expect(decoded).toBeDefined();
      expect(MORSE_ALPHABET[decoded ?? char]).toBe(morse);
    }
  });

  test("preserves character and word spacing boundaries", () => {
    expect(encodeToMorse("EE")).toEqual([1, -3, 1, -3]);
    expect(encodeToMorse("E E")).toEqual([1, -7, 1, -3]);
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

  test("allows a longer configurable pause between symbols", async () => {
    const chars: string[] = [];
    const decoder = new FuzzyDecoder({
      dotDuration: 100,
      symbolGapMs: 40,
      onChar: (char) => chars.push(char),
    });

    decoder.pointerDown(0);
    decoder.pointerUp(80);

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(chars).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 45));
    expect(chars).toEqual(["E"]);
    expect(decoder.symbolGapMs).toBe(40);
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
  test("reset clears buffered symbols before flush", () => {
    const chars: string[] = [];
    const decoder = new FuzzyDecoder({
      dotDuration: 100,
      onChar: (char) => chars.push(char),
    });

    decoder.pointerDown(0);
    decoder.pointerUp(80);
    decoder.reset();

    expect(decoder.currentMorse).toBe("");
    expect(decoder.flush()).toBeNull();
    expect(chars).toEqual([]);
  });

  test("uses the dash threshold at 1.5 dot durations", () => {
    const decoder = new FuzzyDecoder({ dotDuration: 100 });

    decoder.pointerDown(0);
    decoder.pointerUp(149);
    expect(decoder.currentMorse).toBe(".");

    decoder.reset();
    decoder.pointerDown(0);
    decoder.pointerUp(150);
    expect(decoder.currentMorse).toBe("-");
  });
});

type AutomationEvent = {
  method:
    | "cancelScheduledValues"
    | "setValueAtTime"
    | "linearRampToValueAtTime"
    | "setTargetAtTime";
  value?: number;
  startTime: number;
  timeConstant?: number;
};

class MockAudioParam {
  value = 0;
  readonly events: AutomationEvent[] = [];

  cancelScheduledValues(startTime: number): MockAudioParam {
    this.events.push({ method: "cancelScheduledValues", startTime });
    return this;
  }

  setValueAtTime(value: number, startTime: number): MockAudioParam {
    this.value = value;
    this.events.push({ method: "setValueAtTime", value, startTime });
    return this;
  }

  linearRampToValueAtTime(value: number, startTime: number): MockAudioParam {
    this.value = value;
    this.events.push({ method: "linearRampToValueAtTime", value, startTime });
    return this;
  }

  setTargetAtTime(value: number, startTime: number, timeConstant: number): MockAudioParam {
    this.value = value;
    this.events.push({ method: "setTargetAtTime", value, startTime, timeConstant });
    return this;
  }
}

class MockGainNode {
  readonly gain = new MockAudioParam();
  connectCalls = 0;
  disconnectCalls = 0;

  connect(): void {
    this.connectCalls++;
  }

  disconnect(): void {
    this.disconnectCalls++;
  }
}

class MockOscillatorNode {
  type: OscillatorType = "sine";
  readonly frequency = new MockAudioParam();
  readonly startCalls: number[] = [];
  readonly stopCalls: number[] = [];
  connectCalls = 0;
  disconnectCalls = 0;

  connect(): void {
    this.connectCalls++;
  }

  disconnect(): void {
    this.disconnectCalls++;
  }

  start(when = 0): void {
    this.startCalls.push(when);
  }

  stop(when = 0): void {
    this.stopCalls.push(when);
  }
}

class MockAudioBuffer {
  readonly channelData: Float32Array[];

  constructor(
    numberOfChannels: number,
    length: number,
    readonly sampleRate: number,
  ) {
    this.channelData = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.channelData[0]?.length ? this.channelData[0].length / this.sampleRate : 0;
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channelData[channel];
    if (!data) throw new Error(`missing channel ${channel}`);
    return data;
  }
}

class MockAudioBufferSourceNode {
  buffer: MockAudioBuffer | null = null;
  readonly playbackRate = new MockAudioParam();
  readonly startCalls: Array<{ when: number; offset?: number; duration?: number }> = [];
  readonly stopCalls: number[] = [];
  connectCalls = 0;
  disconnectCalls = 0;

  connect(): void {
    this.connectCalls++;
  }

  disconnect(): void {
    this.disconnectCalls++;
  }

  start(when = 0, offset?: number, duration?: number): void {
    this.startCalls.push({ when, offset, duration });
  }

  stop(when = 0): void {
    this.stopCalls.push(when);
  }
}

class MockBiquadFilterNode {
  type: BiquadFilterType = "bandpass";
  readonly frequency = new MockAudioParam();
  readonly Q = new MockAudioParam();
  disconnectCalls = 0;

  connect(): void {
    // no-op
  }

  disconnect(): void {
    this.disconnectCalls++;
  }
}

const mockContexts: MockAudioContext[] = [];

class MockAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  sampleRate = 44_100;
  readonly destination = {};
  readonly gainNodes: MockGainNode[] = [];
  readonly oscillators: MockOscillatorNode[] = [];
  readonly bufferSources: MockAudioBufferSourceNode[] = [];
  readonly buffers: MockAudioBuffer[] = [];
  resumeCalls = 0;
  resolveResume: (() => void) | null = null;

  constructor() {
    mockContexts.push(this);
  }

  createOscillator(): MockOscillatorNode {
    const node = new MockOscillatorNode();
    this.oscillators.push(node);
    return node;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): MockAudioBuffer {
    const buffer = new MockAudioBuffer(numberOfChannels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  decodeAudioData(_data: ArrayBuffer): Promise<MockAudioBuffer> {
    return Promise.resolve(this.createBuffer(1, this.sampleRate * 2, this.sampleRate));
  }

  createBufferSource(): MockAudioBufferSourceNode {
    const node = new MockAudioBufferSourceNode();
    this.bufferSources.push(node);
    return node;
  }

  createBiquadFilter(): MockBiquadFilterNode {
    return new MockBiquadFilterNode();
  }

  createGain(): MockGainNode {
    const node = new MockGainNode();
    this.gainNodes.push(node);
    return node;
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    return new Promise((resolve) => {
      this.resolveResume = () => {
        this.state = "running";
        resolve();
      };
    });
  }

  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
}

function installMockAudioContext(withBattleSamples = false): void {
  mockContexts.length = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      AudioContext: MockAudioContext,
      ...(withBattleSamples ? { location: { origin: "https://radioboi.test" } } : {}),
    },
  });
}

function requireMockContext(): MockAudioContext {
  const ctx = mockContexts[0];
  if (!ctx) throw new Error("missing mock context");
  return ctx;
}

function requireGain(ctx: MockAudioContext, index: number): MockAudioParam {
  const gain = ctx.gainNodes[index]?.gain;
  if (!gain) throw new Error(`missing gain node ${index}`);
  return gain;
}

describe("MorseEngine manual tone latency", () => {
  test("starts held tone and tap pulse synchronously without waiting for resume", () => {
    installMockAudioContext();

    const engine = new MorseEngine();
    const ctx = requireMockContext();
    const heldGain = requireGain(ctx, 0);
    const firstTapGain = requireGain(ctx, 2);

    engine.startTone();

    expect(ctx.resumeCalls).toBe(1);
    expect(heldGain.events).toContainEqual({
      method: "setValueAtTime",
      value: 1,
      startTime: 0,
    });
    expect(firstTapGain.events).toContainEqual({
      method: "setValueAtTime",
      value: 1,
      startTime: 0,
    });
    expect(firstTapGain.events).toContainEqual({
      method: "setTargetAtTime",
      value: 0,
      startTime: 0.055,
      timeConstant: 0.003,
    });
  });

  test("uses one resume request while unlock is already pending", () => {
    installMockAudioContext();

    const engine = new MorseEngine();
    const ctx = requireMockContext();

    engine.startTone();
    void engine.resume();

    expect(ctx.resumeCalls).toBe(1);
  });

  test("keeps an ultra-short tap audible even when released before resume resolves", () => {
    installMockAudioContext();

    const engine = new MorseEngine();
    const ctx = requireMockContext();
    const heldGain = requireGain(ctx, 0);
    const firstTapGain = requireGain(ctx, 2);

    engine.startTone();
    engine.stopTone();

    expect(heldGain.events).toContainEqual({
      method: "setTargetAtTime",
      value: 0,
      startTime: 0,
      timeConstant: 0.003,
    });
    expect(firstTapGain.events).toContainEqual({
      method: "setValueAtTime",
      value: 1,
      startTime: 0.055,
    });
    expect(firstTapGain.events).toContainEqual({
      method: "setTargetAtTime",
      value: 0,
      startTime: 0.055,
      timeConstant: 0.003,
    });
  });

  test("creates a separate tap pulse for each fast Space press", () => {
    installMockAudioContext();

    const engine = new MorseEngine();
    const ctx = requireMockContext();
    ctx.state = "running";

    for (let press = 0; press < 7; press++) {
      ctx.currentTime = press * 0.08;
      engine.startTone();
      ctx.currentTime += 0.015;
      engine.stopTone();
    }

    for (let voice = 0; voice < 7; voice++) {
      const tapGain = requireGain(ctx, 2 + voice);
      expect(tapGain.events).toContainEqual({
        method: "setValueAtTime",
        value: 1,
        startTime: voice * 0.08,
      });
    }
  });

  test("manual tap pulses do not cancel scheduled sequence playback", async () => {
    installMockAudioContext();

    const engine = new MorseEngine();
    const ctx = requireMockContext();
    ctx.state = "running";
    const effectGain = requireGain(ctx, 1);

    const playback = engine.playSequence([1], 20);
    await Promise.resolve();
    const effectEventCount = effectGain.events.length;

    engine.startTone();

    expect(effectGain.events).toHaveLength(effectEventCount);
    await playback;
  });
});

describe("MorseEngine battle sound effects", () => {
  test("preloads supplied recordings and uses the decoded duration for playback", async () => {
    installMockAudioContext(true);
    const originalFetch = globalThis.fetch;
    const requested: string[] = [];

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async (input: RequestInfo | URL) => {
        requested.push(String(input));
        return new Response(new ArrayBuffer(8), { status: 200 });
      },
    });

    try {
      const engine = new MorseEngine();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const ctx = requireMockContext();
      const beforeSources = ctx.bufferSources.length;
      engine.playBattleEffect("missileLaunch");

      expect(requested).toEqual(
        expect.arrayContaining([
          "/audio/shot.m4a",
          "/audio/shooting.m4a",
          "/audio/flying.m4a",
          "/audio/boom.m4a",
          "/audio/splash.m4a",
        ]),
      );
      expect(ctx.bufferSources.length).toBeGreaterThan(beforeSources);
      expect(ctx.bufferSources.at(-1)?.buffer?.duration).toBe(2);
      expect(ctx.bufferSources.at(-1)?.startCalls).toContainEqual({ when: 0 });
      expect(ctx.bufferSources.at(-1)?.stopCalls).toContain(2.02);
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: originalFetch,
      });
    }
  });

  test("schedules distinct one-shot voices for every battle effect", () => {
    installMockAudioContext();

    const engine = new MorseEngine();
    const ctx = requireMockContext();
    ctx.state = "running";
    const effects: BattleSoundEffect[] = [
      "missileLaunch",
      "guidedMissileShot",
      "guidedMissileFlight",
      "guidedHit",
      "guidedMiss",
      "guidedSunk",
      "incomingMissile",
      "hit",
      "miss",
      "sunk",
      "intercept",
      "wrong",
      "targetLock",
      "reloadReady",
    ];

    const persistentOscillators = ctx.oscillators.length;
    for (const effect of effects) {
      const before = ctx.oscillators.length;
      const beforeSources = ctx.bufferSources.length;
      engine.playBattleEffect(effect);

      expect(ctx.oscillators.length + ctx.bufferSources.length).toBeGreaterThan(
        before + beforeSources,
      );
      const created = ctx.oscillators.slice(before);
      const createdSources = ctx.bufferSources.slice(beforeSources);
      expect(
        created.some((oscillator) => oscillator.startCalls.length > 0) ||
          createdSources.some((source) => source.startCalls.length > 0),
      ).toBe(true);
      expect(created.every((oscillator) => oscillator.stopCalls.length > 0)).toBe(true);
      expect(createdSources.every((source) => source.stopCalls.length > 0)).toBe(true);
    }

    expect(ctx.oscillators.length).toBeGreaterThan(persistentOscillators + effects.length);
  });

  test("keeps guided shooting, flight, and impact in order when the impact arrives early", async () => {
    installMockAudioContext(true);
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async () => new Response(new ArrayBuffer(8), { status: 200 }),
    });

    try {
      const engine = new MorseEngine();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const ctx = requireMockContext();

      engine.playGuidedMissileSequence();
      engine.playGuidedMissileImpact("guidedMiss");

      const guidedSources = ctx.bufferSources.slice(-3);
      expect(guidedSources.map((source) => source.startCalls[0]?.when)).toEqual([0, 2, 4]);
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: originalFetch,
      });
    }
  });

  test("realistic battle presets add noise layers for explosions, water, rocket, and intercept", () => {
    installMockAudioContext();

    const engine = new MorseEngine();
    const ctx = requireMockContext();
    ctx.state = "running";
    const noisyEffects: BattleSoundEffect[] = ["missileLaunch", "hit", "miss", "sunk", "intercept"];

    for (const effect of noisyEffects) {
      const beforeSources = ctx.bufferSources.length;
      engine.playBattleEffect(effect);

      expect(ctx.bufferSources.length).toBeGreaterThan(beforeSources);
      expect(ctx.bufferSources.at(-1)?.buffer).not.toBeNull();
    }

    expect(ctx.buffers).toHaveLength(1);
  });

  test("battle effects request unlock but do not cancel Morse sequence playback", async () => {
    installMockAudioContext();

    const engine = new MorseEngine();
    const ctx = requireMockContext();
    const effectGain = requireGain(ctx, 1);

    engine.playBattleEffect("miss");

    expect(ctx.resumeCalls).toBe(1);
    expect(effectGain.events).toHaveLength(0);
    expect(ctx.oscillators.length).toBeGreaterThan(1);

    ctx.resolveResume?.();
    await Promise.resolve();
  });
});
