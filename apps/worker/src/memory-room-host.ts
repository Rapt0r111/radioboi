// In-memory RoomHost for the Node LAN server (no Durable Objects / workerd).

import type { RoomState } from "./game-logic";
import type { RoomHost, TaggedWebSocket } from "./room-host";

export class MemoryRoomHost implements RoomHost {
  readonly #sockets = new Map<TaggedWebSocket, string[]>();
  #state: RoomState | undefined;
  #alarmTimer: ReturnType<typeof setTimeout> | null = null;
  onAlarm: () => void = () => {};

  acceptWebSocket(ws: TaggedWebSocket, tags: string[]): void {
    this.#sockets.set(ws, tags);
  }

  forgetWebSocket(ws: TaggedWebSocket): void {
    this.#sockets.delete(ws);
  }

  getWebSockets(tag?: string): TaggedWebSocket[] {
    const sockets: TaggedWebSocket[] = [];
    this.#sockets.forEach((tags, ws) => {
      if (!tag || tags.indexOf(tag) !== -1) {
        sockets.push(ws);
      }
    });
    return sockets;
  }

  getTags(ws: TaggedWebSocket): string[] {
    return this.#sockets.get(ws) ?? [];
  }

  async setAlarm(fireAt: number | null): Promise<void> {
    if (this.#alarmTimer !== null) {
      clearTimeout(this.#alarmTimer);
      this.#alarmTimer = null;
    }
    if (fireAt === null) return;
    const delay = Math.max(0, fireAt - Date.now());
    this.#alarmTimer = setTimeout(() => {
      this.#alarmTimer = null;
      this.onAlarm();
    }, delay);
  }

  async getStoredState(): Promise<RoomState | undefined> {
    return this.#state;
  }

  async putStoredState(state: RoomState): Promise<void> {
    this.#state = state;
  }

  async getKvSettings(_roomId: string): Promise<string | null> {
    return null;
  }

  dispose(): void {
    if (this.#alarmTimer !== null) {
      clearTimeout(this.#alarmTimer);
      this.#alarmTimer = null;
    }
    this.#sockets.clear();
  }
}
