// apps/worker/src/GameRoomArbitrator.ts
import type { Env } from "./types";

export class GameRoomArbitrator implements DurableObject {
  readonly #state: DurableObjectState;
  readonly #env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.#state = state;
    this.#env   = env;
    this.#state.getWebSockets(); // restore hibernating sockets
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected WebSocket", { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.#state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(_ws: WebSocket, _msg: string | ArrayBuffer): Promise<void> {}
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }
  async webSocketError(ws: WebSocket): Promise<void> { ws.close(1011, "error"); }
}