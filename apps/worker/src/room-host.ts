// Runtime-agnostic sockets/storage used by GameRoomSession.
// Cloudflare Durable Objects and the Node LAN server both implement this.

import type { RoomState } from "./game-logic";

export interface TaggedWebSocket {
  send(data: Uint8Array | string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

export interface RoomHost {
  acceptWebSocket(ws: TaggedWebSocket, tags: string[]): void;
  getWebSockets(tag?: string): TaggedWebSocket[];
  getTags(ws: TaggedWebSocket): string[];
  setAlarm(fireAt: number | null): Promise<void>;
  getStoredState(): Promise<RoomState | undefined>;
  putStoredState(state: RoomState): Promise<void>;
  getKvSettings(roomId: string): Promise<string | null>;
}

export type GameRoomBindings = {
  ALLOWED_ORIGINS?: string | undefined;
  ROOM_STATE?: { get(key: string): Promise<string | null> };
};

export const WS_OPEN = 1;
export const WS_TAG_PREFIX = "player:";

export type JoinRequest = {
  roomId: string;
  playerId: string;
  playerName: string;
  presentedToken: string | null;
  roomSettings: string | null;
};

export type JoinParseResult =
  | { ok: true; join: JoinRequest }
  | { ok: false; status: number; body: string };
