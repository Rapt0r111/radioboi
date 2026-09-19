"use server";

// Cloudflare / OpenNext room registry (KV). Not used by the Windows 8.1 static LAN build.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { RoomSettings } from "@radioboi/game-core";
import { clampRoomSettings, generateRoomCode, ROOM_CODE_RE } from "@radioboi/game-core";

type RoomRecord = {
  status: "waiting" | "active";
  createdAt: number;
};

type JoinResult = { success: true; roomId: string } | { error: string };

function tryGetKV(): KVNamespace | null {
  try {
    const { env } = getCloudflareContext();
    const kv = env.ROOM_STATE;
    return kv ?? null;
  } catch {
    return null;
  }
}

export async function createRoomAction(settings?: Partial<RoomSettings>): Promise<string> {
  const finalSettings = clampRoomSettings(settings ?? {});
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

  return roomId;
}

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
