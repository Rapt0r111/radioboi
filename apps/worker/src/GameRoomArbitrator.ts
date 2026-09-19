// Cloudflare Durable Object wrapper around the portable GameRoomSession.

import { DurableObject } from "cloudflare:workers";
import { GameRoomSession } from "./GameRoomSession";
import type { RoomHost, TaggedWebSocket } from "./room-host";
import type { Env } from "./types";
import type { RoomState } from "./game-logic";

const STATE_KEY = "room:state";

export class GameRoomArbitrator extends DurableObject<Env> {
  #session: GameRoomSession | null = null;

  #getSession(): GameRoomSession {
    if (!this.#session) {
      this.#session = new GameRoomSession(this.#makeHost(), {
        ALLOWED_ORIGINS: this.env.ALLOWED_ORIGINS,
        ROOM_STATE: this.env.ROOM_STATE,
      });
    }
    return this.#session;
  }

  #makeHost(): RoomHost {
    const ctx = this.ctx;
    const env = this.env;
    return {
      acceptWebSocket: (ws, tags) => {
        ctx.acceptWebSocket(ws as WebSocket, tags);
      },
      getWebSockets: (tag) =>
        (tag ? ctx.getWebSockets(tag) : ctx.getWebSockets()) as TaggedWebSocket[],
      getTags: (ws) => ctx.getTags(ws as WebSocket),
      setAlarm: async (fireAt) => {
        if (fireAt === null) {
          await ctx.storage.deleteAlarm();
        } else {
          await ctx.storage.setAlarm(fireAt);
        }
      },
      getStoredState: () => ctx.storage.get<RoomState>(STATE_KEY),
      putStoredState: (state) => ctx.storage.put(STATE_KEY, state),
      getKvSettings: async (roomId) => {
        try {
          return (await env.ROOM_STATE.get(`settings:${roomId}`)) ?? null;
        } catch {
          return null;
        }
      },
    };
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const parsed = this.#getSession().parseJoin(request.url, request.headers.get("Origin"));
    if (!parsed.ok) {
      return new Response(parsed.body, { status: parsed.status });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    await this.#getSession().completeJoin(server, parsed.join);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    return this.#getSession().webSocketMessage(ws, raw);
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    return this.#getSession().webSocketClose(ws, code, reason);
  }

  override webSocketError(ws: WebSocket): Promise<void> {
    return this.#getSession().webSocketError(ws);
  }

  override alarm(): Promise<void> {
    return this.#getSession().alarm();
  }
}
