"use server";

// apps/web/app/actions.ts  ← ПРАВИЛЬНЫЙ ПУТЬ: рядом с layout.tsx
//
// Server Actions для управления комнатами через Cloudflare KV.
// Тип env.ROOM_STATE раскрывается через глобальную аугментацию CloudflareEnv
// в apps/web/cloudflare-env.d.ts — никакого приведения типов не нужно.

import { getCloudflareContext } from "@opennextjs/cloudflare";

// ── Типы ─────────────────────────────────────────────────────────────────────

type RoomRecord = {
  status: "waiting" | "active";
  createdAt: number;
};

type JoinResult = { success: true; roomId: string } | { error: string };

// ── Вспомогательные функции ───────────────────────────────────────────────────

/**
 * Генерирует случайный 6-значный буквенно-цифровой код, например `A7K9P2`.
 * Использует `crypto.getRandomValues` (Web Crypto API — доступен в CF Workers).
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
 * 2. Записывает в Cloudflare KV со статусом `waiting` и TTL 1 час.
 * 3. Возвращает сгенерированный `roomId`.
 */
export async function createRoomAction(): Promise<string> {
  // getCloudflareContext() — синхронная функция; env типизирован через CloudflareEnv.
  const { env } = getCloudflareContext();
  const kv = env.ROOM_STATE; // KVNamespace — из cloudflare-env.d.ts

  // Генерируем уникальный код. Ограничение попыток защищает от бесконечного цикла.
  let roomId = generateRoomCode();
  let attempts = 0;
  const MAX_ATTEMPTS = 10;

  while ((await kv.get(roomId)) !== null) {
    if (attempts++ >= MAX_ATTEMPTS) {
      throw new Error("createRoomAction: не удалось сгенерировать уникальный код комнаты");
    }
    roomId = generateRoomCode();
  }

  const record: RoomRecord = { status: "waiting", createdAt: Date.now() };
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

  const { env } = getCloudflareContext();
  const kv = env.ROOM_STATE;

  const existing = await kv.get(normalized);
  if (existing === null) {
    return { error: "Room not found" };
  }

  return { success: true, roomId: normalized };
}
