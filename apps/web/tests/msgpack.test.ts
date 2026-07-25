import { decode, encode } from "@msgpack/msgpack";
import { GameEventType, type ClientGameEvent } from "@radioboi/game-core";
import { describe, expect, test } from "bun:test";
import { decodeServerEvent, encodeClientEvent, FrameDecodeError } from "../src/lib/network/msgpack";

describe("web msgpack helpers", () => {
  test("encodes client events into a standalone ArrayBuffer", () => {
    const event: ClientGameEvent = {
      type: GameEventType.JOIN_ROOM,
      payload: { playerId: "p1", playerName: "Player" },
    };

    const frame = encodeClientEvent(event);

    expect(frame).toBeInstanceOf(ArrayBuffer);
    expect(decode(new Uint8Array(frame))).toEqual(event);
  });

  test("decodes server events from ArrayBuffer and Blob frames", async () => {
    const event = {
      type: GameEventType.GAME_STARTED,
      payload: { firstTurnPlayerId: "p1" },
    };
    const bytes = encode(event);
    const frame = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    await expect(decodeServerEvent(frame)).resolves.toEqual(event);
    await expect(decodeServerEvent(new Blob([frame]))).resolves.toEqual(event);
  });

  test("wraps malformed frames and missing event types", async () => {
    await expect(decodeServerEvent(new Uint8Array([0xff]).buffer)).rejects.toThrow(
      FrameDecodeError,
    );

    const bytes = encode({ payload: {} });
    const frame = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    await expect(decodeServerEvent(frame)).rejects.toMatchObject({
      name: "FrameDecodeError",
      message: "Frame missing `type` field",
      raw: frame,
    });
  });
});
