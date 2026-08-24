// apps/worker/src/index.ts
// Единственная задача этого файла — точка входа воркера.
//
// FIX (LOW): Используем env.GAME_ROOM.getByName() вместо idFromName()+get().
// Оба метода детерминированы (одно имя → один и тот же DO instance), но
// getByName() — современный рекомендуемый API (меньше кода, яснее намерение).

import { DurableObject } from "cloudflare:workers";
import { normalizeRoomId } from "@radioboi/game-core";
import { envFlagEnabled } from "./security";
import type { Env } from "./types";

export { GameRoomArbitrator } from "./GameRoomArbitrator";
export type { Env } from "./types";

void DurableObject;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const roomMatch = url.pathname.match(/^\/room\/([^/]+)$/);
    if (roomMatch) {
      const roomId = normalizeRoomId(roomMatch[1] ?? "");
      if (roomId === null) {
        return new Response("Invalid room id", { status: 400 });
      }

      if (envFlagEnabled(env.REQUIRE_ROOM_REGISTRY)) {
        try {
          const record = await env.ROOM_STATE.get(roomId);
          if (record === null) {
            return new Response("Room not found", { status: 404 });
          }
        } catch {
          return new Response("Room registry unavailable", { status: 503 });
        }
      }

      const stub = env.GAME_ROOM.getByName(roomId);
      return stub.fetch(request);
    }

    return new Response(JSON.stringify({ service: "radioboi-worker", status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  },
} satisfies ExportedHandler<Env>;