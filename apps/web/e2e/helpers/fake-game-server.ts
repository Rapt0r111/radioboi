import type { Page } from "@playwright/test";
import { encode } from "@msgpack/msgpack";

type ServerEvent = {
  type: string;
  payload: Record<string, unknown>;
};

declare global {
  interface Window {
    __radioboiFakeServer: {
      sent: unknown[];
      urls: string[];
      emit(bytes: number[]): void;
      socketCount(): number;
    };
  }
}

export async function installFakeGameServer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeAudioParam {
      value = 0;
      setValueAtTime(value: number) {
        this.value = value;
      }
      linearRampToValueAtTime(value: number) {
        this.value = value;
      }
      setTargetAtTime(value: number) {
        this.value = value;
      }
      cancelScheduledValues() {}
    }

    class FakeAudioNode {
      connect() {
        return this;
      }
    }

    class FakeOscillatorNode extends FakeAudioNode {
      frequency = new FakeAudioParam();
      type = "sine";
      start() {}
      stop() {}
    }

    class FakeBiquadFilterNode extends FakeAudioNode {
      frequency = new FakeAudioParam();
      Q = new FakeAudioParam();
      type = "bandpass";
    }

    class FakeGainNode extends FakeAudioNode {
      gain = new FakeAudioParam();
    }

    class FakeAudioContext {
      currentTime = 0;
      destination = new FakeAudioNode();
      state = "running";
      createOscillator() {
        return new FakeOscillatorNode();
      }
      createBiquadFilter() {
        return new FakeBiquadFilterNode();
      }
      createGain() {
        return new FakeGainNode();
      }
      async resume() {}
      async close() {}
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: FakeAudioContext,
    });

    const NativeWebSocket = window.WebSocket;
    const sockets: FakeWebSocket[] = [];
    const sent: unknown[] = [];
    const urls: string[] = [];

    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      binaryType: BinaryType = "arraybuffer";
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;
      readyState = FakeWebSocket.CONNECTING;
      url = "";
      private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

      constructor(url: string | URL, protocols?: string | string[]) {
        if (!String(url).includes("/room/")) {
          return new NativeWebSocket(url, protocols) as unknown as FakeWebSocket;
        }
        this.url = String(url);
        urls.push(this.url);
        sockets.push(this);
        setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      send(data: unknown) {
        sent.push(data);
      }

      close(code = 1000, reason = "closed") {
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }

      emit(data: ArrayBuffer) {
        this.dispatchEvent(new MessageEvent("message", { data }));
      }

      addEventListener(
        type: string,
        callback: EventListenerOrEventListenerObject | null,
      ) {
        if (callback === null) return;
        const existing = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
        existing.add(callback);
        this.listeners.set(type, existing);
      }

      removeEventListener(
        type: string,
        callback: EventListenerOrEventListenerObject | null,
      ) {
        if (callback === null) return;
        this.listeners.get(type)?.delete(callback);
      }

      dispatchEvent(event: Event): boolean {
        const callbacks = this.listeners.get(event.type);
        if (callbacks !== undefined) {
          for (const callback of callbacks) {
            if (typeof callback === "function") {
              callback.call(this, event);
            } else {
              callback.handleEvent(event);
            }
          }
        }
        const handler =
          event.type === "open"
            ? this.onopen
            : event.type === "message"
              ? this.onmessage
              : event.type === "close"
                ? this.onclose
                : event.type === "error"
                  ? this.onerror
                  : null;
        if (handler !== null) {
          handler.call(this, event as never);
        }
        return true;
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      writable: true,
      value: FakeWebSocket,
    });

    window.__radioboiFakeServer = {
      sent,
      urls,
      emit(bytes: number[]) {
        const socket = sockets.at(-1);
        if (!socket) throw new Error("No fake WebSocket is connected");
        socket.emit(new Uint8Array(bytes).buffer);
      },
      socketCount() {
        return sockets.length;
      },
    };
  });
}

export function encodeServerEvent(event: ServerEvent): number[] {
  return Array.from(encode(event));
}

export async function emitServerEvent(page: Page, event: ServerEvent): Promise<void> {
  const bytes = encodeServerEvent(event);
  await page.evaluate((payload) => window.__radioboiFakeServer.emit(payload), bytes);
}
