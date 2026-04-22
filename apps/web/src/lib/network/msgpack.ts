// apps/web/src/lib/network/msgpack.ts
// Thin wrapper around @msgpack/msgpack for typed encode/decode.
// Kept in its own file so it can be imported by both the game client
// and any future Web Worker offload of serialisation.

import { decode, encode } from '@msgpack/msgpack';
import type { ClientGameEvent, ServerGameEvent } from '@radioboi/game-core';

// ── Encode (client → server) ──────────────────────────────────────────────────

/**
 * Serialises a typed client event to a binary MessagePack frame.
 * The result should be sent as a WebSocket binary message.
 */
export function encodeClientEvent(event: ClientGameEvent): Uint8Array {
  return encode(event);
}

// ── Decode (server → client) ──────────────────────────────────────────────────

/** Thrown when a frame cannot be decoded as a valid ServerGameEvent. */
export class FrameDecodeError extends Error {
  constructor(
    message: string,
    public readonly raw: ArrayBuffer | Blob,
  ) {
    super(message);
    this.name = 'FrameDecodeError';
  }
}

/**
 * Deserialises a binary frame received from the server.
 *
 * @throws {FrameDecodeError} if the frame is not valid MessagePack,
 *   or lacks a string `type` field.
 *
 * NOTE: The return type is `ServerGameEvent` as a structural assertion —
 * runtime type narrowing is done at the call site via the `type` field of
 * the discriminated union.
 */
export async function decodeServerEvent(
  data: ArrayBuffer | Blob,
): Promise<ServerGameEvent> {
  try {
    const buffer =
      data instanceof Blob ? await data.arrayBuffer() : data;
    const decoded = decode(new Uint8Array(buffer));

    if (
      typeof decoded !== 'object'
      || decoded === null
      || typeof (decoded as Record<string, unknown>)['type'] !== 'string'
    ) {
      throw new FrameDecodeError('Frame missing `type` field', data);
    }

    return decoded as ServerGameEvent;
  } catch (err) {
    if (err instanceof FrameDecodeError) throw err;
    throw new FrameDecodeError(
      `MessagePack decode failed: ${String(err)}`,
      data,
    );
  }
}