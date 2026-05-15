"use server";

// apps/web/app/actions.ts
//
// Server Actions для управления комнатами через Cloudflare KV.
// NEW: createRoomAction accepts RoomSettings and stores them under
//      `settings:{roomId}` key so GameRoomArbitrator can read them
//      on first connection.

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

function getKV(): KVNamespace {
  const { env } = getCloudflareContext();
  const kv = env.ROOM_STATE;
  if (!kv) {
    throw new Error(
      "ROOM_STATE KV binding is not available. " +
        "Ensure apps/web/wrangler.toml exists with [[kv_namespaces]] binding = \"ROOM_STATE\".",
    );
  }
  return kv;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampSettings(raw: Partial<RoomSettings>): RoomSettings {
  return {
    battleMode: raw.battleMode === "async" ? "async" : "turn-based",
    attackCooldownMs: clampNumber(
      raw.attackCooldownMs,
      5_000,
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
 * Settings are stored under `settings:{roomId}` in KV (TTL 1h).
 * GameRoomArbitrator reads them on first connection.
 */
export async function createRoomAction(settings?: Partial<RoomSettings>): Promise<string> {
  const kv = getKV();

  let roomId = generateRoomCode();
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

  // Store settings separately so GameRoomArbitrator can read them
  const finalSettings = clampSettings(settings ?? {});
  await kv.put(`settings:${roomId}`, JSON.stringify(finalSettings), { expirationTtl: 3600 });

  return roomId;
}

export async function joinRoomAction(code: string): Promise<JoinResult> {
  const normalized = code.trim().toUpperCase();

  if (!ROOM_CODE_RE.test(normalized)) {
    return { error: "Invalid room code" };
  }

  const kv = getKV();
  const existing = await kv.get(normalized);
  if (existing === null) {
    return { error: "Room not found" };
  }

  return { success: true, roomId: normalized };
}
