"use server";

// apps/web/src/app/actions.ts
// Server Actions для управления комнатами через Cloudflare KV.
// KV-биндинг `ROOM_STATE` доступен через @opennextjs/cloudflare.

import { getCloudflareContext } from "@opennextjs/cloudflare";

// ── Типы ─────────────────────────────────────────────────────────────────────

type RoomRecord = {
  status: "waiting" | "active";
  createdAt: number;
};

type JoinResult =
  | { success: true; roomId: string }
  | { error: string };

// ── Вспомогательные функции ───────────────────────────────────────────────────

/**
 * Генерирует случайный 6-значный буквенно-цифровой код, например `A7K9P2`.
 * Использует `crypto.getRandomValues` (доступно в Cloudflare Workers runtime).
 */
function generateRoomCode(): string {
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CHARS[b % CHARS.length]).join("");
}

// ── Server Actions ────────────────────────────────────────────────────────────

/**
 * Создаёт новую комнату:
 * 1. Генерирует уникальный 6-значный код.
 * 2. Записывает запись в Cloudflare KV со статусом `waiting` и TTL 1 час.
 * 3. Возвращает сгенерированный `roomId`.
 */
export async function createRoomAction(): Promise<string> {
  const { env } = await getCloudflareContext();
  const kv = env.ROOM_STATE as KVNamespace;

  // Генерируем уникальный код (повторяем при коллизии, практически невероятной).
  let roomId: string;
  do {
    roomId = generateRoomCode();
  } while (await kv.get(roomId) !== null);

  const record: RoomRecord = {
    status: "waiting",
    createdAt: Date.now(),
  };

  await kv.put(roomId, JSON.stringify(record), { expirationTtl: 3600 });

  return roomId;
}

/**
 * Присоединяется к существующей комнате:
 * 1. Нормализует код в верхний регистр, проверяет длину (ровно 6 символов).
 * 2. Ищет код в Cloudflare KV.
 * 3. Если комнаты нет — возвращает `{ error: 'Room not found' }`.
 * 4. Если есть — возвращает `{ success: true, roomId: code }`.
 */
export async function joinRoomAction(code: string): Promise<JoinResult> {
  const normalized = code.trim().toUpperCase();

  if (normalized.length !== 6) {
    return { error: "Invalid room code" };
  }

  const { env } = await getCloudflareContext();
  const kv = env.ROOM_STATE as KVNamespace;

  const existing = await kv.get(normalized);
  if (existing === null) {
    return { error: "Room not found" };
  }

  return { success: true, roomId: normalized };
}