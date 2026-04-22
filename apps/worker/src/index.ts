// Путь: /apps/worker/src/index.ts
// Фаза 0: заглушки воркера и Durable Object.
// Игровая логика будет добавлена в следующих фазах.

// ── Типы окружения (соответствуют wrangler.toml) ─────────────────────────

export interface Env {
  /** KV Namespace для хранения состояния комнат */
  ROOM_STATE: KVNamespace;
  /** Durable Object binding для игровых комнат */
  GAME_ROOM: DurableObjectNamespace;
}

// ── Durable Object: GameRoomArbitrator ───────────────────────────────────

export class GameRoomArbitrator implements DurableObject {
  // Фаза 0: поля не используются в stub-реализации.
  // Префикс _ сигнализирует линтеру о намеренном неиспользовании.
  // В Фазе 1 будут заменены на приватные поля #state / #env.
  constructor(
    private readonly _state: DurableObjectState,
    private readonly _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    // WebSocket-апгрейд будет реализован в Фазе 1.
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    return new Response("GameRoomArbitrator stub", { status: 501 });
  }
}

// ── Fetch Handler (точка входа воркера) ──────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // /room/:id → маршрутизация в Durable Object
    const roomMatch = url.pathname.match(/^\/room\/([a-zA-Z0-9_-]+)$/);
    if (roomMatch) {
      const roomId = env.GAME_ROOM.idFromName(roomMatch[1] as string);
      const stub = env.GAME_ROOM.get(roomId);
      return stub.fetch(request);
    }

    return new Response(
      JSON.stringify({ service: "radioboi-worker", status: "ok" }),
      { headers: { "Content-Type": "application/json" } },
    );
  },
} satisfies ExportedHandler<Env>;