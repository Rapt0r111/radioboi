"use server";

// apps/web/app/actions.ts
//
// Server Actions for room create/join.
//
// Production (Cloudflare / OpenNext): stores rooms + settings in KV (ROOM_STATE).
// Offline / Node standalone production: KV is unavailable — generate room codes
// locally and accept joins by format. The Worker creates the room on first
// WebSocket connect and reads settings from the WS query string (creator).

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { RoomSettings } from "@radioboi/game-core";
import { clampRoomSettings, ROOM_CODE_RE } from "@radioboi/game-core";

// ── Types ─────────────────────────────────────────────────────────────────────

type RoomRecord = {
  status: "waiting" | "active";
  createdAt: number;
};

type JoinResult = { success: true; roomId: string } | { error: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateRoomCode(): string {
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const chars: string[] = [];
  while (chars.length < 6) {
    const bytes = new Uint8Array(6 - chars.length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      // 252 is the largest multiple of 36 below 256 — reject the remainder to
      // avoid modulo bias on the 36-character alphabet.
      if (byte < 252) chars.push(CHARS[byte % 36] as string);
      if (chars.length === 6) break;
    }
  }
  return chars.join("");
}

/**
 * Returns ROOM_STATE when running under Cloudflare / OpenNext (prod or `next dev`
 * with initOpenNextCloudflareForDev). Returns null for Node standalone / offline
 * production where getCloudflareContext has no bindings.
 */
function tryGetKV(): KVNamespace | null {
  try {
    const { env } = getCloudflareContext();
    const kv = env.ROOM_STATE;
    return kv ?? null;
  } catch {
    return null;
  }
}

function clampSettings(raw: Partial<RoomSettings>): RoomSettings {
  return clampRoomSettings(raw);
}

// ── Server Actions ────────────────────────────────────────────────────────────

/**
 * Creates a new room with optional RoomSettings.
 *
 * With KV (Cloudflare production / local OpenNext dev):
 *   - uniqueness check + `settings:{roomId}` stored for the Worker.
 * Without KV (Node standalone / offline LAN package):
 *   - returns a random code; creator settings travel via clientSession + WS query.
 */
export async function createRoomAction(settings?: Partial<RoomSettings>): Promise<string> {
  const finalSettings = clampSettings(settings ?? {});
  const kv = tryGetKV();

  let roomId = generateRoomCode();

  if (kv) {
    let attempts = 0;
    const MAX_ATTEMPTS = 10;

    while ((await kv.get(roomId)) !== null) {
      if (attempts++ >= MAX_ATTEMPTS) {
        throw new Error("createRoomAction: failed to generate a unique room code");
      }
      roomId = generateRoomCode();
    }

    const record: RoomRecord = { status: "waiting", createdAt: Date.now() };
    await kv.put(roomId, JSON.stringify(record), { expirationTtl: 3600 });
    await kv.put(`settings:${roomId}`, JSON.stringify(finalSettings), { expirationTtl: 3600 });
    return roomId;
  }

  // Offline / standalone: no shared lobby registry. Worker creates the DO on connect.
  return roomId;
}

/**
 * Join an existing room by code.
 *
 * With KV: rejects unknown codes ("Room not found").
 * Without KV: accepts any valid 6-char code (LAN offline / standalone).
 * Empty rooms are created by the Worker when the first player connects.
 */
export async function joinRoomAction(code: string): Promise<JoinResult> {
  const normalized = code.trim().toUpperCase();

  if (!ROOM_CODE_RE.test(normalized)) {
    return { error: "Invalid room code" };
  }

  const kv = tryGetKV();
  if (kv) {
    const existing = await kv.get(normalized);
    if (existing === null) {
      return { error: "Room not found" };
    }
  }

  return { success: true, roomId: normalized };
}
