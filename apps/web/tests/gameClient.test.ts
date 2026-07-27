import { decode, encode } from "@msgpack/msgpack";
import {
  GameEventType,
  makeCoordinate,
  type ClientGameEvent,
  type ServerGameEvent,
} from "@radioboi/game-core";
import { beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionStatus } from "../src/lib/network/gameClient";
import { useGameStore } from "../src/store/gameStore";

type Listener = (event: unknown) => void;
type ListenerType = "open" | "message" | "close" | "error";

const sockets: FakeWebSocket[] = [];

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  binaryType: BinaryType = "blob";
  readyState = FakeWebSocket.CONNECTING;
  readonly sent: ArrayBuffer[] = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  readonly listeners: Record<ListenerType, Set<Listener>> = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  };

  constructor(readonly url: string) {
    sockets.push(this);
  }

  addEventListener(type: ListenerType, listener: Listener): void {
    this.listeners[type].add(listener);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (data instanceof ArrayBuffer) {
      this.sent.push(data);
      return;
    }
    if (ArrayBuffer.isView(data)) {
      const copy = new Uint8Array(data.byteLength);
      copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      this.sent.push(copy.buffer);
      return;
    }
    throw new Error(`Unsupported fake socket payload: ${typeof data}`);
  }

  close(code?: number, reason?: string): void {
    const call: { code?: number; reason?: string } = {};
    if (code !== undefined) call.code = code;
    if (reason !== undefined) call.reason = reason;
    this.closeCalls.push(call);
    this.readyState = FakeWebSocket.CLOSED;
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    for (const listener of this.listeners.open) listener({});
  }

  emitMessage(data: ArrayBuffer): void {
    for (const listener of this.listeners.message) listener({ data });
  }

  emitClose(code: number, reason = ""): void {
    this.readyState = FakeWebSocket.CLOSED;
    for (const listener of this.listeners.close) listener({ code, reason });
  }
}

Object.defineProperty(globalThis, "WebSocket", {
  configurable: true,
  value: FakeWebSocket as unknown as typeof WebSocket,
});

process.env.NEXT_PUBLIC_WS_URL = "ws://unit.test";

const { GameClient } = await import("../src/lib/network/gameClient");

function encodeServerFrame(event: ServerGameEvent): ArrayBuffer {
  const bytes = encode(event);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function decodeClientFrame(frame: ArrayBuffer): ClientGameEvent {
  return decode(new Uint8Array(frame)) as ClientGameEvent;
}

describe("GameClient", () => {
  beforeEach(() => {
    sockets.length = 0;
    useGameStore.getState().reset();
  });

  test("connects with room settings and sends JOIN_ROOM on open", () => {
    const client = new GameClient();
    const statuses: ConnectionStatus[] = [];
    client.onStatusChange((status) => statuses.push(status));

    client.connect("ROOM1", "p1", "Player 1", {
      battleMode: "async",
      difficulty: "normal",
      attackCooldownMs: 3_000,
      interceptWindowMs: 20_000,
      maxInterceptAttempts: 2,
    });

    const socket = sockets[0];
    expect(socket).toBeDefined();
    expect(socket?.url).toContain("ws://unit.test/room/ROOM1?");
    expect(socket?.url).toContain("playerId=p1");
    expect(socket?.url).toContain("settings=");

    socket?.emitOpen();

    expect(client.status).toBe("connected");
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(socket?.binaryType).toBe("arraybuffer");
    expect(socket?.sent).toHaveLength(1);
    expect(decodeClientFrame(socket!.sent[0]!)).toEqual({
      type: GameEventType.JOIN_ROOM,
      payload: { playerId: "p1", playerName: "Player 1" },
    });
  });

  test("queues non-join events while disconnected and flushes after open", () => {
    const client = new GameClient();
    const launchEvent: ClientGameEvent = {
      type: GameEventType.MISSILE_LAUNCHED,
      payload: {
        missileId: "m1",
        target: makeCoordinate(0, 0),
        morseSequence: ["."],
        timestamp: 1,
      },
    };

    client.send({ type: GameEventType.JOIN_ROOM, payload: { playerId: "ignored", playerName: "x" } });
    client.send(launchEvent);
    client.connect("ROOM2", "p2", "Player 2");
    sockets[0]?.emitOpen();

    expect(sockets[0]?.sent.map(decodeClientFrame)).toEqual([
      { type: GameEventType.JOIN_ROOM, payload: { playerId: "p2", playerName: "Player 2" } },
      launchEvent,
    ]);
  });

  test("applies decoded server frames and dispatches subscribed handlers", async () => {
    const client = new GameClient();
    const received: ServerGameEvent[] = [];
    const unsubscribe = client.on(GameEventType.GAME_STARTED, (event) => received.push(event));

    client.connect("ROOM3", "p1", "Player 1");
    sockets[0]?.emitOpen();
    sockets[0]?.emitMessage(
      encodeServerFrame({
        type: GameEventType.GAME_STARTED,
        payload: { firstTurnPlayerId: "" },
      }),
    );
    await Promise.resolve();

    expect(useGameStore.getState().phase).toBe("battle");
    expect(useGameStore.getState().settings.battleMode).toBe("async");
    expect(received).toHaveLength(1);

    sockets[0]?.emitMessage(
      encodeServerFrame({
        type: GameEventType.MISSILE_FIRED,
        payload: { missileId: "m1", attackerId: "p2", timestamp: 123 },
      }),
    );
    await Promise.resolve();
    expect(useGameStore.getState().activeMissiles).toEqual([
      { id: "m1", target: "", launchedAt: 123 },
    ]);

    unsubscribe();
    sockets[0]?.emitMessage(
      encodeServerFrame({
        type: GameEventType.GAME_STARTED,
        payload: { firstTurnPlayerId: "p1" },
      }),
    );
    await Promise.resolve();

    expect(received).toHaveLength(1);
  });

  test("fatal close disconnects while normal close schedules reconnect status", () => {
    const fatal = new GameClient();
    fatal.connect("ROOM4", "p1", "Player 1");
    sockets[0]?.emitOpen();
    sockets[0]?.emitClose(4001, "bad session");

    expect(fatal.status).toBe("disconnected");

    const reconnecting = new GameClient();
    reconnecting.connect("ROOM5", "p2", "Player 2");
    sockets[1]?.emitOpen();
    sockets[1]?.emitClose(1006);

    expect(reconnecting.status).toBe("reconnecting");
  });

  test("discards malformed server frames without dispatching", async () => {
    const client = new GameClient();
    const received: ServerGameEvent[] = [];
    client.on(GameEventType.ERROR, (event) => received.push(event));

    client.connect("ROOM6", "p1", "Player 1");
    sockets[0]?.emitOpen();
    sockets[0]?.emitMessage(new Uint8Array([0xff]).buffer);
    await Promise.resolve();

    expect(received).toEqual([]);
  });
});
