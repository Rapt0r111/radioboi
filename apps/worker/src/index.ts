// apps/worker/src/index.ts
// Единственная задача этого файла — точка входа воркера.
//
// FIX: GameRoomArbitrator теперь extends DurableObject<Env> (не implements).
// При этом паттерне class автоматически получает this.ctx и this.env от платформы.
// Экспорт остаётся идентичным — изменения только внутри класса.

import { DurableObject } from "cloudflare:workers";
export { GameRoomArbitrator } from "./GameRoomArbitrator";
export type { Env } from "./types";

// Проверяем что DurableObject импортируется корректно (без этого импорта
// `extends DurableObject<Env>` не найдёт базовый класс в GameRoomArbitrator.ts)
void DurableObject;

import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const roomMatch = url.pathname.match(/^\/room\/([a-zA-Z0-9_-]+)$/);
    if (roomMatch) {
      // FIX: используем idFromName для детерминированного роутинга.
      // Одно и то же имя комнаты всегда попадёт в один и тот же DO instance.
      const roomId = env.GAME_ROOM.idFromName(roomMatch[1] as string);
      const stub = env.GAME_ROOM.get(roomId);
      return stub.fetch(request);
    }

    return new Response(JSON.stringify({ service: "radioboi-worker", status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  },
} satisfies ExportedHandler<Env>;