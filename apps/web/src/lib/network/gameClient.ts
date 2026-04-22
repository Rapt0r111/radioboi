// apps/web/src/lib/network/gameClient.ts
'use client';

import {
  GameEventType,
  type ClientGameEvent,
  type Coordinate,
  type ServerGameEvent,
} from '@radioboi/game-core';
import { FrameDecodeError, decodeServerEvent, encodeClientEvent } from './msgpack.js';
import { useGameStore } from '@/src/store/gameStore.js';

// ── Configuration ─────────────────────────────────────────────────────────────

const DEFAULT_WS_URL    = process.env['NEXT_PUBLIC_WS_URL'] ?? 'ws://localhost:8787';
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS  = 30_000;
const RECONNECT_JITTER  = 0.2;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

type EventHandler<T extends ServerGameEvent = ServerGameEvent> = (event: T) => void;

type HandlerMap = {
  [K in ServerGameEvent['type']]?: Set<EventHandler<Extract<ServerGameEvent, { type: K }>>>;
};

// ── GameClient class ──────────────────────────────────────────────────────────

export class GameClient {
  #ws:             WebSocket | null = null;
  #status:         ConnectionStatus = 'disconnected';
  #reconnectDelay: number           = RECONNECT_BASE_MS;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #destroyed:      boolean          = false;
  #url:            string           = '';

  readonly #handlers: HandlerMap = {};
  readonly #statusListeners = new Set<(status: ConnectionStatus) => void>();

  // ── Connection lifecycle ──────────────────────────────────────────────────

  connect(roomId: string, playerId: string, playerName: string): void {
    if (this.#destroyed) throw new Error('GameClient has been destroyed');
    this.#url = `${DEFAULT_WS_URL}/room/${roomId}?playerId=${encodeURIComponent(playerId)}&playerName=${encodeURIComponent(playerName)}`;
    this.#openSocket(playerId, playerName);
  }

  destroy(): void {
    this.#destroyed = true;
    this.#clearReconnectTimer();
    this.#ws?.close(1000, 'Client destroyed');
    this.#ws = null;
    this.#setStatus('disconnected');
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  // ── Sending ───────────────────────────────────────────────────────────────

  /**
   * Serialises and sends a typed event to the server.
   * Silently drops the frame if the socket is not OPEN.
   * `encodeClientEvent` returns `ArrayBuffer`, which `WebSocket.send()` accepts
   * directly without a type error.
   */
  send(event: ClientGameEvent): void {
    if (this.#ws?.readyState !== WebSocket.OPEN) return;
    try {
      this.#ws.send(encodeClientEvent(event));
    } catch (err) {
      console.warn('[GameClient] send error:', err);
    }
  }

  // ── Typed event subscription ──────────────────────────────────────────────

  on<K extends ServerGameEvent['type']>(
    type:    K,
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

  #openSocket(playerId: string, playerName: string): void {
    this.#clearReconnectTimer();
    this.#setStatus(this.#status === 'disconnected' ? 'connecting' : 'reconnecting');

    try {
      const ws = new WebSocket(this.#url);
      ws.binaryType = 'arraybuffer';
      this.#ws = ws;

      ws.addEventListener('open', () => {
        if (ws !== this.#ws) return;
        this.#reconnectDelay = RECONNECT_BASE_MS;
        this.#setStatus('connected');
        this.send({ type: GameEventType.JOIN_ROOM, payload: { playerId, playerName } });
      });

      ws.addEventListener('message', (ev: MessageEvent<ArrayBuffer | Blob | string>) => {
        if (ws !== this.#ws) return;
        if (typeof ev.data === 'string') return;
        void this.#handleFrame(ev.data as ArrayBuffer | Blob);
      });

      ws.addEventListener('close', (ev) => {
        if (ws !== this.#ws) return;
        this.#ws = null;
        if (!this.#destroyed) {
          console.info(`[GameClient] socket closed (${ev.code}); reconnecting…`);
          this.#scheduleReconnect(playerId, playerName);
        }
      });

      ws.addEventListener('error', () => {
        console.warn('[GameClient] WebSocket error');
      });
    } catch (err) {
      console.error('[GameClient] WebSocket construction failed:', err);
      if (!this.#destroyed) this.#scheduleReconnect(playerId, playerName);
    }
  }

  #scheduleReconnect(playerId: string, playerName: string): void {
    const jitter = 1 + (Math.random() * 2 - 1) * RECONNECT_JITTER;
    const delay  = Math.min(this.#reconnectDelay * jitter, RECONNECT_MAX_MS);
    this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, RECONNECT_MAX_MS);
    this.#setStatus('reconnecting');
    this.#reconnectTimer = setTimeout(() => {
      if (!this.#destroyed) this.#openSocket(playerId, playerName);
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
        console.warn('[GameClient] Malformed frame discarded:', err.message);
      }
      return;
    }
    this.#applyToStore(event);
    this.#dispatch(event);
  }

  /**
   * Applies known server events to the Zustand gameStore.
   *
   * Board state (ownBoard / enemyBoard) is always authoritative on the server.
   * After each RESOLVE_HIT the server immediately sends SYNC_STATE with updated
   * boards, so board mutations here are intentionally minimal — we only handle
   * phase transitions and missile tracking.
   */
  #applyToStore(event: ServerGameEvent): void {
    const store = useGameStore.getState();

    switch (event.type) {
      // ── PLAYER_JOINED: no store mutation needed; UI subscribes via on() ──
      case GameEventType.PLAYER_JOINED:
        break;

      // ── GAME_STARTED: advance phase, set turn flag ─────────────────────
      case GameEventType.GAME_STARTED:
        store.setPhase('battle');
        break;

      // ── INCOMING_MISSILE: register in activeMissiles so the UI can
      //    animate/display the incoming missile indicator.
      //    target is unknown to the defender — stored as a branded empty
      //    string; it will be overwritten when RESOLVE_HIT arrives. ──────
      case GameEventType.INCOMING_MISSILE:
        store.addMissile({
          id:         event.payload.missileId,
          // Defender does not know the target yet; placeholder required by type.
          target:     '' as unknown as Coordinate,
          launchedAt: event.payload.timestamp,
        });
        break;

      // ── RESOLVE_HIT: mark the missile as resolved and advance game phase
      //    if the game is over.  Board cells are updated by the SYNC_STATE
      //    message that the server sends immediately afterwards. ───────────
      case GameEventType.RESOLVE_HIT:
        store.interceptMissile(event.payload.missileId);
        if (event.payload.isGameOver) {
          store.setPhase('gameOver');
        }
        break;

      // ── SYNC_STATE: full authoritative snapshot from the server.
      //    Sets the phase; board sync requires a future store action
      //    (store.syncFromServer) that will be added in Phase 3. ──────────
      case GameEventType.SYNC_STATE:
        store.setPhase(event.payload.phase);
        break;

      // ── ERROR: log; UI subscribes via on() for toast display ──────────
      case GameEventType.ERROR:
        console.error(
          `[GameClient] Server error ${event.payload.code}: ${event.payload.message}`,
        );
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
  if (typeof window === 'undefined') {
    throw new Error(
      'getGameClient() must only be called in browser environments. '
      + 'Use dynamic import or wrap in useEffect.',
    );
  }
  _instance ??= new GameClient();
  return _instance;
}

export function destroyGameClient(): void {
  _instance?.destroy();
  _instance = null;
}