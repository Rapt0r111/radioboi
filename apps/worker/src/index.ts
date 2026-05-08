// apps/worker/src/index.ts
// Единственная задача этого файла — точка входа воркера.
//
// FIX (LOW): Используем env.GAME_ROOM.getByName() вместо idFromName()+get().
// Оба метода детерминированы (одно имя → один и тот же DO instance), но
// getByName() — современный рекомендуемый API (меньше кода, яснее намерение).

import { DurableObject } from "cloudflare:workers";
export { GameRoomArbitrator } from "./GameRoomArbitrator";
export type { Env } from "./types";

void DurableObject;

import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const roomMatch = url.pathname.match(/^\/room\/([a-zA-Z0-9_-]+)$/);
    if (roomMatch) {
      // FIX: getByName() — современный детерминированный роутинг.
      // Заменяет idFromName() + get() — идентично по поведению, чище по синтаксису.
      const stub = env.GAME_ROOM.getByName(roomMatch[1] as string);
      return stub.fetch(request);
    }

    return new Response(JSON.stringify({ service: "radioboi-worker", status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  },
} satisfies ExportedHandler<Env>;