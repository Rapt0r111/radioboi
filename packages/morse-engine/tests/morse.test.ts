import { describe, expect, test } from "bun:test";
import { encodeToMorse, FuzzyDecoder, MORSE_ALPHABET, MorseEngine } from "../src";
import type { BattleSoundEffect } from "../src";

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

class MockBiquadFilterNode {
  type: BiquadFilterType = "bandpass";
  readonly frequency = new MockAudioParam();
  readonly Q = new MockAudioParam();

  connect(): void {
    // no-op
  }
}

const mockContexts: MockAudioContext[] = [];

class MockAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  readonly destination = {};
  readonly gainNodes: MockGainNode[] = [];
  readonly oscillators: MockOscillatorNode[] = [];
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

function installMockAudioContext(): void {
  mockContexts.length = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      AudioContext: MockAudioContext,
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
  test("schedules distinct one-shot voices for every battle effect", () => {
    installMockAudioContext();

    const engine = new MorseEngine();
    const ctx = requireMockContext();
    ctx.state = "running";
    const effects: BattleSoundEffect[] = [
      "missileLaunch",
      "incomingMissile",
      "hit",
      "miss",
      "sunk",
      "intercept",
      "wrong",
    ];

    const persistentOscillators = ctx.oscillators.length;
    for (const effect of effects) {
      const before = ctx.oscillators.length;
      engine.playBattleEffect(effect);

      expect(ctx.oscillators.length).toBeGreaterThan(before);
      const created = ctx.oscillators.slice(before);
      expect(created.some((oscillator) => oscillator.startCalls.length > 0)).toBe(true);
      expect(created.every((oscillator) => oscillator.stopCalls.length > 0)).toBe(true);
    }

    expect(ctx.oscillators.length).toBeGreaterThan(persistentOscillators + effects.length);
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
