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
import { DEFAULT_ROOM_SETTINGS } from "@radioboi/game-core";

// ── Types ─────────────────────────────────────────────────────────────────────

type RoomRecord = {
  status: "waiting" | "active";
  createdAt: number;
};

type JoinResult = { success: true; roomId: string } | { error: string };
const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateRoomCode(): string {
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CHARS[b % CHARS.length]).join("");
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

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampSettings(raw: Partial<RoomSettings>): RoomSettings {
  const legacy = raw as Partial<RoomSettings> & { beginnerMode?: boolean };
  const difficulty = legacy.difficulty === "beginner" || legacy.difficulty === "normal" || legacy.difficulty === "expert"
    ? legacy.difficulty
    : legacy.beginnerMode === true
      ? "beginner"
      : DEFAULT_ROOM_SETTINGS.difficulty;
  return {
    battleMode: raw.battleMode === "async" ? "async" : "turn-based",
    difficulty,
    attackCooldownMs: clampNumber(
      raw.attackCooldownMs,
      2_000,
      60_000,
      DEFAULT_ROOM_SETTINGS.attackCooldownMs,
    ),
    interceptWindowMs: clampNumber(
      raw.interceptWindowMs,
      10_000,
      60_000,
      DEFAULT_ROOM_SETTINGS.interceptWindowMs,
    ),
    maxInterceptAttempts: clampNumber(
      raw.maxInterceptAttempts,
      1,
      5,
      DEFAULT_ROOM_SETTINGS.maxInterceptAttempts,
    ),
  };
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
