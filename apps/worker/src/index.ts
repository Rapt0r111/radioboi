// apps/worker/src/index.ts
// Единственная задача этого файла — точка входа воркера.
// Env и GameRoomArbitrator живут в своих модулях.

export { GameRoomArbitrator } from "./GameRoomArbitrator.js";
export type { Env } from "./types.js";

import type { Env } from "./types.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const roomMatch = url.pathname.match(/^\/room\/([a-zA-Z0-9_-]+)$/);
    if (roomMatch) {
      const roomId = env.GAME_ROOM.idFromName(roomMatch[1] as string);
      const stub = env.GAME_ROOM.get(roomId);
      return stub.fetch(request);
    }

    return new Response(JSON.stringify({ service: "radioboi-worker", status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  },
} satisfies ExportedHandler<Env>;
