// apps/web/src/lib/network/msgpack.ts

import { decode, encode } from "@msgpack/msgpack";
import type { ClientGameEvent, ServerGameEvent } from "@radioboi/game-core";

// ── Encode (client → server) ──────────────────────────────────────────────────

/**
 * Serialises a typed client event to a binary MessagePack frame.
 *
 * Returns a plain `ArrayBuffer` (not `Uint8Array<ArrayBufferLike>`) so that
 * the browser's `WebSocket.send()` overload — which requires
 * `BufferSource | Blob | string`, where BufferSource = `ArrayBuffer |
 * ArrayBufferView<ArrayBuffer>` — accepts it without a type error.
 *
 * `Uint8Array.buffer` is typed as `ArrayBufferLike` (includes SharedArrayBuffer),
 * so we use `.slice()` to guarantee a fresh, non-shared `ArrayBuffer`.
 * The slice cost is O(n) but frames are small (< 1 KB), so it is negligible.
 */
export function encodeClientEvent(event: ClientGameEvent): ArrayBuffer {
  const u8 = encode(event);
  // u8.byteOffset may be non-zero when msgpack reuses a pooled buffer.
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

// ── Decode (server → client) ──────────────────────────────────────────────────

/** Thrown when a frame cannot be decoded as a valid ServerGameEvent. */
export class FrameDecodeError extends Error {
  constructor(
    message: string,
    public readonly raw: ArrayBuffer | Blob,
  ) {
    super(message);
    this.name = "FrameDecodeError";
  }
}

/**
 * Deserialises a binary frame received from the server.
 *
 * @throws {FrameDecodeError} if the frame is not valid MessagePack,
 *   or lacks a string `type` field.
 */
export async function decodeServerEvent(data: ArrayBuffer | Blob): Promise<ServerGameEvent> {
  try {
    const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
    const decoded = decode(new Uint8Array(buffer));

    if (
      typeof decoded !== "object" ||
      decoded === null ||
      typeof (decoded as Record<string, unknown>)["type"] !== "string"
    ) {
      throw new FrameDecodeError("Frame missing `type` field", data);
    }

    return decoded as ServerGameEvent;
  } catch (err) {
    if (err instanceof FrameDecodeError) throw err;
    throw new FrameDecodeError(`MessagePack decode failed: ${String(err)}`, data);
  }
}
