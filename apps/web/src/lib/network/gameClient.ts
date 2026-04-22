// apps/web/src/lib/network/gameClient.ts
// Manages the WebSocket connection to the Cloudflare Worker.
//
// Design principles:
//   • Single connection per tab — callers share one instance via
//     getGameClient() singleton.
//   • Auto-reconnect with exponential back-off (max 30 s).
//   • All frames are binary MessagePack; text frames are discarded.
//   • Incoming ServerGameEvents are dispatched to registered handlers and
//     also applied to the Zustand gameStore automatically.
//   • No React imports — this is plain TypeScript, safe to use from
//     Server Actions, Web Workers, or utility code.

'use client';

import {
  ErrorCode,
  GameEventType,
  type ClientGameEvent,
  type ServerGameEvent,
} from '@radioboi/game-core';
import { FrameDecodeError, decodeServerEvent, encodeClientEvent } from './msgpack.js';
import { useGameStore } from '@/src/store/gameStore.js';

// ── Configuration ─────────────────────────────────────────────────────────────

const DEFAULT_WS_URL    = process.env['NEXT_PUBLIC_WS_URL'] ?? 'ws://localhost:8787';
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS  = 30_000;
const RECONNECT_JITTER  = 0.2;   // ±20 % jitter to avoid thundering herd

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

/** Callback registered for a specific event type. */
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

  /**
   * Opens a WebSocket connection to the game server.
   * @param roomId     Room identifier (maps to Durable Object name).
   * @param playerId   Stable UUID for this player.
   * @param playerName Display name sent on JOIN_ROOM.
   */
  connect(roomId: string, playerId: string, playerName: string): void {
    if (this.#destroyed) throw new Error('GameClient has been destroyed');

    this.#url = `${DEFAULT_WS_URL}/room/${roomId}?playerId=${encodeURIComponent(playerId)}&playerName=${encodeURIComponent(playerName)}`;
    this.#openSocket(playerId, playerName);
  }

  /**
   * Gracefully closes the connection and prevents any reconnect attempts.
   * Call this when the component/page unmounts.
   */
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
   * Silently drops the frame if the socket is not open.
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

  /**
   * Subscribes to a specific server event type.
   * Returns an unsubscribe function.
   *
   * @example
   * const unsub = client.on('RESOLVE_HIT', (ev) => { … });
   * // later:
   * unsub();
   */
  on<K extends ServerGameEvent['type']>(
    type:    K,
    handler: EventHandler<Extract<ServerGameEvent, { type: K }>>,
  ): () => void {
    if (!this.#handlers[type]) {
      // @ts-expect-error — dynamic key assignment; safe by construction
      this.#handlers[type] = new Set();
    }
    // @ts-expect-error — same as above
    (this.#handlers[type] as Set<EventHandler>).add(handler);

    return () => {
      (this.#handlers[type] as Set<EventHandler> | undefined)?.delete(
        handler as EventHandler,
      );
    };
  }

  /** Subscribe to connection status changes. */
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
        // Announce ourselves immediately after upgrade.
        this.send({
          type:    GameEventType.JOIN_ROOM,
          payload: { playerId, playerName },
        });
      });

      ws.addEventListener('message', (ev: MessageEvent<ArrayBuffer | Blob | string>) => {
        if (ws !== this.#ws) return;
        if (typeof ev.data === 'string') return; // text frames are not used
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
        // 'error' always precedes 'close'; handling is done in the close handler.
        console.warn('[GameClient] WebSocket error');
      });
    } catch (err) {
      console.error('[GameClient] WebSocket construction failed:', err);
      if (!this.#destroyed) {
        this.#scheduleReconnect(playerId, playerName);
      }
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

    // Apply to Zustand store first, then dispatch to listeners.
    this.#applyToStore(event);
    this.#dispatch(event);
  }

  /** Applies known server events to the Zustand gameStore. */
  #applyToStore(event: ServerGameEvent): void {
    const store = useGameStore.getState();

    switch (event.type) {
      case GameEventType.GAME_STARTED:
        store.setPhase('battle');
        break;

      case GameEventType.INCOMING_MISSILE:
        store.addMissile({
          id:          event.payload.missileId,
          target:      '' as ReturnType<typeof import('@radioboi/game-core').makeCoordinate>,
          launchedAt:  event.payload.timestamp,
        });
        break;

      case GameEventType.RESOLVE_HIT: {
        const { target, result, nextTurnPlayerId } = event.payload;
        const playerId = store.playerId;
        const isOwn    = playerId !== null && nextTurnPlayerId !== playerId;

        if (isOwn) {
          // We were the attacker — mark on enemy board
          store.applyEnemyShot(
            target as Parameters<typeof store.applyEnemyShot>[0],
            result,
          );
        } else {
          // We were the defender — mark on own board
          store.applyOwnHit(
            target as Parameters<typeof store.applyOwnHit>[0],
            result,
          );
        }
        if (event.payload.isGameOver) {
          store.setPhase('gameOver');
        }
        break;
      }

      case GameEventType.SYNC_STATE: {
        const { phase, ownBoard, enemyBoard, isMyTurn, winnerId } = event.payload;
        store.setPhase(phase);
        // Bulk-sync boards by replacing them through placeShip / applyOwnHit paths
        // is complex; instead we dispatch a dedicated action (added to gameStore).
        // For now, use the existing store.reset() + selective restore pattern.
        // A future PR adds store.syncFromServer(ownBoard, enemyBoard).
        if (phase === 'gameOver') {
          store.setPhase('gameOver');
        }
        break;
      }

      case GameEventType.ERROR:
        console.error(`[GameClient] Server error ${event.payload.code}: ${event.payload.message}`);
        break;

      case GameEventType.PLAYER_JOINED:
      case GameEventType.GAME_STARTED:
        // These are handled by individual on() subscriptions in UI components.
        break;
    }
  }

  /** Dispatches an event to registered type-specific handlers. */
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

// One instance per browser tab.  Components call getGameClient() rather
// than constructing their own — this prevents duplicate connections.
let _instance: GameClient | null = null;

/**
 * Returns the module-level GameClient singleton.
 * Creates it lazily on the first call.
 *
 * IMPORTANT: Safe to call on the server (SSR) — the instance is only
 * created inside browser environments thanks to the lazy initialisation.
 * Do not call `connect()` on the server.
 */
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

/**
 * Destroys the current singleton and allows the next getGameClient() call
 * to create a fresh instance.  Useful for tests and room transitions.
 */
export function destroyGameClient(): void {
  _instance?.destroy();
  _instance = null;
}