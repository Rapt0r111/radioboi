"use client";
// apps/web/src/lib/network/gameClient.ts

import {
  type ClientGameEvent,
  type Coordinate,
  FATAL_WS_CLOSE_CODE,
  GameEventType,
  makeLocalPlayerSummary,
  messageForFatalCloseReason,
  normalizePlayerName,
  type RoomSettings,
  type ServerGameEvent,
} from "@radioboi/game-core";
import { useGameStore } from "@/src/store/gameStore";
import { readStoredSeatToken, rememberSeatToken } from "@/src/lib/clientSession";
import { decodeServerEvent, encodeClientEvent, FrameDecodeError } from "./msgpack";

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Resolve the Worker WebSocket base URL.
 *
 * Order:
 * 1. Explicit `NEXT_PUBLIC_WS_URL` (Cloudflare deploy / fixed override).
 * 2. Same hostname the page was opened with + `NEXT_PUBLIC_WS_PORT` (default 8787).
 *    This keeps LAN play working no matter which local IP the player types.
 * 3. Loopback fallback for non-browser contexts.
 */
export function resolveWsBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const port = process.env.NEXT_PUBLIC_WS_PORT?.trim() || "8787";

  if (typeof window !== "undefined" && window.location?.hostname) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.hostname}:${port}`;
  }

  return `ws://127.0.0.1:${port}`;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS  = 30_000;
const RECONNECT_JITTER  = 0.2;
const MAX_OUTBOX_EVENTS = 32;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

type EventHandler<T extends ServerGameEvent = ServerGameEvent> = (event: T) => void;

type HandlerMap = {
  [K in ServerGameEvent["type"]]?: Set<EventHandler<Extract<ServerGameEvent, { type: K }>>>;
};

// ── GameClient class ──────────────────────────────────────────────────────────

export class GameClient {
  #ws: WebSocket | null = null;
  #status: ConnectionStatus = "disconnected";
  #reconnectDelay  = RECONNECT_BASE_MS;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #destroyed = false;
  #url = "";
  #roomId = "";
  #playerId = "";
  #playerName = "";
  #seatToken = "";
  #fatalReason: string | null = null;
  readonly #outbox: ClientGameEvent[] = [];

  readonly #handlers: HandlerMap = {};
  readonly #statusListeners = new Set<(status: ConnectionStatus) => void>();

  // ── Connection lifecycle ──────────────────────────────────────────────────

  connect(
    roomId: string,
    playerId: string,
    playerName: string,
    roomSettings?: RoomSettings,
    seatToken?: string,
  ): void {
    if (this.#destroyed) throw new Error("GameClient has been destroyed");
    const normalizedPlayerName = normalizePlayerName(playerName) ?? "Player";
    this.#roomId = roomId;
    this.#playerId = playerId;
    this.#playerName = normalizedPlayerName;
    this.#seatToken = seatToken ?? readStoredSeatToken(roomId) ?? "";
    useGameStore.getState().setSession(playerId, roomId, normalizedPlayerName);
    this.#url = this.#buildUrl(roomSettings);
    this.#openSocket();
  }

  #buildUrl(roomSettings?: RoomSettings): string {
    const params = new URLSearchParams({
      playerId: this.#playerId,
      playerName: this.#playerName,
    });
    if (this.#seatToken.length > 0) {
      params.set("seatToken", this.#seatToken);
    }
    if (roomSettings !== undefined) {
      params.set("settings", JSON.stringify(roomSettings));
    }
    return `${resolveWsBaseUrl()}/room/${this.#roomId}?${params.toString()}`;
  }

  #captureSeatToken(token: string): void {
    if (token.length === 0 || token === this.#seatToken) return;
    this.#seatToken = token;
    rememberSeatToken(this.#roomId, token);
    this.#url = this.#buildUrl();
  }

  reconnect(): void {
    if (this.#destroyed || !this.#url) return;
    this.#clearReconnectTimer();
    this.#ws?.close(1000, "Client reconnect");
    this.#ws = null;
    this.#openSocket();
  }

  destroy(): void {
    this.#destroyed = true;
    this.#clearReconnectTimer();
    this.#ws?.close(1000, "Client destroyed");
    this.#ws = null;
    this.#outbox.length = 0;
    this.#fatalReason = null;
    this.#setStatus("disconnected");
  }

  get status(): ConnectionStatus { return this.#status; }

  /** Human-readable reason after a permanent close (e.g. ROOM_FULL). */
  get fatalReason(): string | null { return this.#fatalReason; }

  // ── Sending ───────────────────────────────────────────────────────────────

  send(event: ClientGameEvent): void {
    if (!this.#sendNow(event)) {
      this.#queueEvent(event);
    }
  }

  #sendNow(event: ClientGameEvent): boolean {
    if (this.#ws?.readyState !== WebSocket.OPEN) return false;
    try {
      this.#ws.send(encodeClientEvent(event));
      return true;
    } catch (err) {
      console.warn("[GameClient] send error:", err);
      return false;
    }
  }

  #queueEvent(event: ClientGameEvent): void {
    if (event.type === GameEventType.JOIN_ROOM) return;
    this.#outbox.push(event);
    if (this.#outbox.length > MAX_OUTBOX_EVENTS) {
      this.#outbox.splice(0, this.#outbox.length - MAX_OUTBOX_EVENTS);
    }
  }

  #flushOutbox(): void {
    while (this.#outbox.length > 0 && this.#ws?.readyState === WebSocket.OPEN) {
      const event = this.#outbox.shift();
      if (event !== undefined && !this.#sendNow(event)) {
        this.#outbox.unshift(event);
        return;
      }
    }
  }

  // ── Typed event subscription ──────────────────────────────────────────────

  on<K extends ServerGameEvent["type"]>(
    type: K,
    handler: EventHandler<Extract<ServerGameEvent, { type: K }>>,
  ): () => void {
    if (!this.#handlers[type]) {
      // @ts-expect-error — dynamic key; safe by construction
      this.#handlers[type] = new Set();
    }
    // @ts-expect-error — same as above
    (this.#handlers[type] as Set<EventHandler>).add(handler);
    return () => {
      (this.#handlers[type] as Set<EventHandler> | undefined)?.delete(handler as EventHandler);
    };
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  // ── Private: socket management ────────────────────────────────────────────

  #openSocket(): void {
    this.#clearReconnectTimer();
    this.#ws?.close(1000, "Socket replaced");
    this.#setStatus(this.#status === "disconnected" ? "connecting" : "reconnecting");

    try {
      const ws = new WebSocket(this.#url);
      ws.binaryType = "arraybuffer";
      this.#ws = ws;

      ws.addEventListener("open", () => {
        if (ws !== this.#ws) return;
        this.#reconnectDelay = RECONNECT_BASE_MS;
        this.#fatalReason = null;
        this.#setStatus("connected");
        this.#sendNow({
          type: GameEventType.JOIN_ROOM,
          payload: { playerId: this.#playerId, playerName: this.#playerName },
        });
        this.#flushOutbox();
      });

      ws.addEventListener("message", (ev: MessageEvent<ArrayBuffer | Blob | string>) => {
        if (ws !== this.#ws) return;
        if (typeof ev.data === "string") return;
        void this.#handleFrame(ev.data as ArrayBuffer | Blob);
      });

      ws.addEventListener("close", (ev) => {
        if (ws !== this.#ws) return;
        this.#ws = null;
        if (!this.#destroyed && ev.code !== FATAL_WS_CLOSE_CODE) {
          console.info(`[GameClient] socket closed (${ev.code}); reconnecting...`);
          this.#scheduleReconnect();
        } else if (ev.code === FATAL_WS_CLOSE_CODE) {
          this.#fatalReason = messageForFatalCloseReason(ev.reason ?? "");
          console.warn(`[GameClient] socket closed permanently (${ev.code}): ${ev.reason}`);
          this.#setStatus("disconnected");
        }
      });
      ws.addEventListener("error", () => {
        console.warn("[GameClient] WebSocket error");
      });
    } catch (err) {
      console.error("[GameClient] WebSocket construction failed:", err);
      if (!this.#destroyed) this.#scheduleReconnect();
    }
  }

  #scheduleReconnect(): void {
    const jitter = 1 + (Math.random() * 2 - 1) * RECONNECT_JITTER;
    const delay = Math.min(this.#reconnectDelay * jitter, RECONNECT_MAX_MS);
    this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, RECONNECT_MAX_MS);
    this.#setStatus("reconnecting");
    this.#reconnectTimer = setTimeout(() => {
      if (!this.#destroyed) this.#openSocket();
    }, delay);
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #setStatus(next: ConnectionStatus): void {
    if (this.#status === next) return;
    this.#status = next;
    for (const l of this.#statusListeners) l(next);
  }

  // ── Private: frame handling ───────────────────────────────────────────────

  async #handleFrame(data: ArrayBuffer | Blob): Promise<void> {
    let event: ServerGameEvent;
    try {
      event = await decodeServerEvent(data);
    } catch (err) {
      if (err instanceof FrameDecodeError) {
        console.warn("[GameClient] Malformed frame discarded:", err.message);
      }
      return;
    }
    if (event.type === GameEventType.RESOLVE_HIT) {
      // Reserve the reveal window before applying RESOLVE_HIT; the following
      // SYNC_STATE must be held until the flight animation has completed.
      this.#dispatch(event);
      this.#applyToStore(event);
      return;
    }

    this.#applyToStore(event);
    this.#dispatch(event);
  }

  #applyToStore(event: ServerGameEvent): void {
    const store = useGameStore.getState();

    switch (event.type) {
      case GameEventType.PLAYER_JOINED:
        // Optimistic local roster; authoritative presence arrives via SYNC_STATE.
        store.upsertPlayer(
          makeLocalPlayerSummary(event.payload.playerId, event.payload.playerName),
        );
        break;

      case GameEventType.GAME_STARTED:
        // Async mode sends firstTurnPlayerId="" — only advance phase, don't set turn
        store.setPhase("battle");
        if (event.payload.firstTurnPlayerId === "") {
          useGameStore.setState((state) => ({
            isMyTurn: false,
            settings: { ...state.settings, battleMode: "async" },
          }));
        }
        break;

      case GameEventType.MISSILE_FIRED:
        store.addMissile({
          id: event.payload.missileId,
          target: "" as unknown as Coordinate,
          launchedAt: event.payload.timestamp,
        });
        break;

      case GameEventType.INCOMING_MISSILE:
        store.addMissile({
          id: event.payload.missileId,
          target: "" as unknown as Coordinate,
          launchedAt: event.payload.timestamp,
        });
        break;

      case GameEventType.RESOLVE_HIT:
        if (store.deferredRevealCount === 0) {
          store.interceptMissile(event.payload.missileId);
          if (event.payload.isGameOver) {
            store.setPhase("gameOver");
            useGameStore.setState({ winnerId: event.payload.winnerId ?? null });
          }
        }
        break;

      case GameEventType.MISSILE_INTERCEPTED:
        store.interceptMissile(event.payload.missileId);
        break;

      case GameEventType.SYNC_STATE:
        if (typeof event.payload.seatToken === "string") {
          this.#captureSeatToken(event.payload.seatToken);
        }
        store.syncFromServer(event.payload);
        break;

      // Async mode: server tells us exactly when we can fire again
      case GameEventType.ATTACK_COOLDOWN_UPDATE:
        store.setAttackCooldown(event.payload.expiresAt);
        break;

      case GameEventType.ERROR:
        if (event.payload.code === "MORSE_MISMATCH") {
          console.info(`[GameClient] Server: ${event.payload.message}`);
        } else {
          console.error(`[GameClient] Server error ${event.payload.code}: ${event.payload.message}`);
        }
        break;
    }
  }

  #dispatch(event: ServerGameEvent): void {
    const set = this.#handlers[event.type] as Set<EventHandler> | undefined;
    if (!set) return;
    for (const handler of set) {
      try {
        handler(event);
      } catch (err) {
        console.error(`[GameClient] Handler error for ${event.type}:`, err);
      }
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: GameClient | null = null;

export function getGameClient(): GameClient {
  if (typeof window === "undefined") {
    throw new Error(
      "getGameClient() must only be called in browser environments. " +
        "Use dynamic import or wrap in useEffect.",
    );
  }
  _instance ??= new GameClient();
  return _instance;
}

export function destroyGameClient(): void {
  _instance?.destroy();
  _instance = null;
}
