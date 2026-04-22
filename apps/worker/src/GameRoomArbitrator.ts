// apps/worker/src/GameRoomArbitrator.ts

import type { Env } from './types.js';
import {
  decodeEvent,
  makeError,
  makeGameStarted,
  makeIncomingMissile,
  makePlayerJoined,
  makeResolveHit,
  makeSyncState,
} from './protocol.js';
import {
  MAX_INTERCEPT_ATTEMPTS,
  addPlayer,
  applyShipsPlaced,
  createRoomState,
  getEnemyBoard,
  getOpponentId,
  getOwnBoard,
  prepareAttack,
  processInterceptAttempt,
  recordMorseSequence,
} from './game-logic.js';
import type { RoomPhase, RoomState } from './game-logic.js';
import { validateMorseForCoord } from './morse.js';

// ── Coordinate helpers (inlined — no game-core dep in worker) ─────────────────

const COLUMNS = [
  'АБВ', 'ГДЕ', 'ЖЗИ', 'ЙКЛ', 'МНО',
  'ПРС', 'ТУФ', 'ХЦЧ', 'ШЩЪ', 'ЫЭЮ',
] as const;

const ROWS = ['000','001','002','003','004','005','006','007','008','009'] as const;

function isValidCoord(s: string): boolean {
  if (s.length !== 6) return false;
  return (COLUMNS as ReadonlyArray<string>).includes(s.slice(0, 3))
      && (ROWS    as ReadonlyArray<string>).includes(s.slice(3, 6));
}

function coordToIndices(coord: string): { colIndex: number; rowIndex: number } | null {
  if (!isValidCoord(coord)) return null;
  const colIndex = (COLUMNS as ReadonlyArray<string>).indexOf(coord.slice(0, 3));
  const rowIndex = (ROWS    as ReadonlyArray<string>).indexOf(coord.slice(3, 6));
  return colIndex === -1 || rowIndex === -1 ? null : { colIndex, rowIndex };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATE_KEY     = 'room:state';
const WS_TAG_PREFIX = 'player:';

// ── Durable Object ────────────────────────────────────────────────────────────

export class GameRoomArbitrator implements DurableObject {
  readonly #state: DurableObjectState;
  readonly #env:   Env;

  constructor(state: DurableObjectState, env: Env) {
    this.#state = state;
    this.#env   = env;
    this.#state.getWebSockets();
  }

  // ── HTTP upgrade → WebSocket ───────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const url        = new URL(request.url);
    const roomId     = url.pathname.split('/').pop() ?? 'unknown';
    const playerId   = url.searchParams.get('playerId');
    const playerName = url.searchParams.get('playerName') ?? 'Player';

    if (!playerId) {
      return new Response('Missing playerId query param', { status: 400 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.#state.acceptWebSocket(server, [`${WS_TAG_PREFIX}${playerId}`]);

    const roomState = await this.#loadState(roomId);
    const addResult = addPlayer(roomState, {
      id:      playerId,
      name:    playerName,
      wsTag:   `${WS_TAG_PREFIX}${playerId}`,
      isReady: roomState.players.find((p) => p.id === playerId)?.isReady ?? false,
    });

    if (!addResult.ok) {
      server.close(4001, addResult.reason);
      return new Response(null, { status: 101, webSocket: client });
    }

    await this.#saveState(roomState);

    this.#broadcast(
      makePlayerJoined(playerId, playerName, roomState.players.length as 1 | 2),
      null,
    );

    this.#sendToPlayer(
      playerId,
      makeSyncState(
        roomState.phase,
        getOwnBoard(roomState, playerId),
        getEnemyBoard(roomState, playerId),
        [],
        roomState.currentTurnId === playerId,
        roomState.winnerId ?? undefined,
      ),
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── WebSocket event handlers (Hibernation API) ─────────────────────────────

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const event = decodeEvent(raw);
    if (!event) return;

    const tag = this.#state.getTags(ws).find((t) => t.startsWith(WS_TAG_PREFIX));
    if (!tag) return;
    const senderId = tag.slice(WS_TAG_PREFIX.length);

    const roomState = await this.#loadState();

    switch (event.type) {
      case 'JOIN_ROOM':
        break;
      case 'SHIPS_PLACED':
        await this.#handleShipsPlaced(ws, senderId, event.payload, roomState);
        break;
      case 'ATTACK_PREP':
        await this.#handleAttackPrep(ws, senderId, event.payload, roomState);
        break;
      case 'MISSILE_LAUNCHED':
        await this.#handleMissileLaunched(ws, senderId, event.payload, roomState);
        break;
      case 'INTERCEPT_ATTEMPT':
        await this.#handleInterceptAttempt(ws, senderId, event.payload, roomState);
        break;
      default:
        ws.send(makeError('UNKNOWN_EVENT', `Unknown event type: ${event.type}`));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    ws.close(1011, 'WebSocket error');
  }

  // ── Game event handlers ────────────────────────────────────────────────────

  async #handleShipsPlaced(
    ws:       WebSocket,
    playerId: string,
    payload:  Record<string, unknown>,
    state:    RoomState,
  ): Promise<void> {
    if (state.phase !== 'placement') {
      ws.send(makeError('GAME_NOT_STARTED', 'Ship placement is not open'));
      return;
    }
    if (state.players.find((p) => p.id === playerId)?.isReady) {
      ws.send(makeError('INVALID_PLACEMENT', 'Ships already placed'));
      return;
    }

    const ships = payload['ships'];
    if (!Array.isArray(ships) || ships.length === 0) {
      ws.send(makeError('INVALID_PLACEMENT', 'ships must be a non-empty array'));
      return;
    }
    for (const ship of ships) {
      if (
        typeof ship !== 'object' || ship === null
        || !Array.isArray((ship as Record<string, unknown>)['coords'])
      ) {
        ws.send(makeError('INVALID_PLACEMENT', 'Each ship must have a coords array'));
        return;
      }
      for (const coord of (ship as { coords: unknown[] }).coords) {
        if (typeof coord !== 'string' || !isValidCoord(coord)) {
          ws.send(makeError('INVALID_COORDINATE', `Invalid coordinate: ${String(coord)}`));
          return;
        }
      }
    }

    applyShipsPlaced(state, playerId, ships as Array<{ coords: string[] }>);
    await this.#saveState(state);

    // FIX: TypeScript narrowed `state.phase` to `'placement'` via the guard
    // at the top of this handler.  `applyShipsPlaced` may mutate it to
    // `'battle'` when both players are ready, but control-flow analysis
    // cannot see through an opaque function call.  Reading through the
    // shared `RoomPhase` alias re-widens the type to the full union.
    const phaseAfterPlacement: RoomPhase = state.phase;

    if (phaseAfterPlacement === 'battle') {
      this.#broadcast(makeGameStarted(state.currentTurnId!), null);
      this.#sendSyncToAll(state);
    }
  }

  async #handleAttackPrep(
    ws:       WebSocket,
    playerId: string,
    payload:  Record<string, unknown>,
    state:    RoomState,
  ): Promise<void> {
    const target    = payload['target'];
    const missileId = payload['missileId'];

    if (typeof target !== 'string' || typeof missileId !== 'string') {
      ws.send(makeError('INVALID_COORDINATE', 'target and missileId are required'));
      return;
    }

    const result = prepareAttack(state, playerId, target, missileId);
    if (!result.ok) {
      ws.send(makeError(result.reason, result.reason));
      return;
    }

    await this.#saveState(state);
  }

  async #handleMissileLaunched(
    ws:       WebSocket,
    playerId: string,
    payload:  Record<string, unknown>,
    state:    RoomState,
  ): Promise<void> {
    const missileId     = payload['missileId'];
    const target        = payload['target'];
    const morseSequence = payload['morseSequence'];
    const timestamp     = payload['timestamp'];

    if (
      typeof missileId !== 'string'
      || typeof target !== 'string'
      || !Array.isArray(morseSequence)
      || typeof timestamp !== 'number'
    ) {
      ws.send(makeError('INVALID_COORDINATE', 'Invalid MISSILE_LAUNCHED payload'));
      return;
    }

    const attack = state.pendingAttack;
    if (!attack || attack.missileId !== missileId || attack.attackerId !== playerId) {
      ws.send(makeError('NO_PENDING_ATTACK', 'No matching ATTACK_PREP found'));
      return;
    }

    const indices = coordToIndices(target);
    if (!indices) {
      ws.send(makeError('INVALID_COORDINATE', `Invalid target coordinate: ${target}`));
      return;
    }

    if (!validateMorseForCoord(morseSequence as string[], indices.colIndex, indices.rowIndex)) {
      ws.send(makeError('MORSE_MISMATCH', 'Morse sequence does not match target coordinate'));
      return;
    }

    recordMorseSequence(state, missileId, morseSequence as string[]);
    await this.#saveState(state);

    const opponentId = getOpponentId(state, playerId);
    if (opponentId) {
      this.#sendToPlayer(
        opponentId,
        makeIncomingMissile(missileId, morseSequence as string[], timestamp, MAX_INTERCEPT_ATTEMPTS),
      );
    }
  }

  async #handleInterceptAttempt(
    ws:       WebSocket,
    playerId: string,
    payload:  Record<string, unknown>,
    state:    RoomState,
  ): Promise<void> {
    const missileId     = payload['missileId'];
    const decodedCoord  = payload['decodedCoord'];
    const attemptNumber = payload['attemptNumber'];

    if (
      typeof missileId !== 'string'
      || typeof decodedCoord !== 'string'
      || typeof attemptNumber !== 'number'
    ) {
      ws.send(makeError('INVALID_COORDINATE', 'Invalid INTERCEPT_ATTEMPT payload'));
      return;
    }

    if (!isValidCoord(decodedCoord)) {
      ws.send(makeError('INVALID_COORDINATE', `Invalid coordinate: ${decodedCoord}`));
      return;
    }

    const forceResolve = attemptNumber >= MAX_INTERCEPT_ATTEMPTS;

    const resolveResult = processInterceptAttempt(
      state,
      playerId,
      missileId,
      decodedCoord,
      attemptNumber,
      forceResolve,
    );

    if (resolveResult === null) {
      // Wrong decode, attempts remain — client may retry.
      return;
    }

    await this.#saveState(state);

    const lastShot   = state.shotLog[state.shotLog.length - 1];
    const shotTarget = lastShot?.target ?? '';
    const defenderDecodedCorrectly = decodedCoord === shotTarget;

    this.#broadcast(
      makeResolveHit(
        missileId,
        shotTarget,
        resolveResult.result,
        state.currentTurnId ?? (lastShot?.attackerId ?? playerId),
        resolveResult.isGameOver,
        defenderDecodedCorrectly,
        resolveResult.winnerId ?? undefined,
      ),
      null,
    );

    this.#sendSyncToAll(state);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  #sendToPlayer(playerId: string, frame: Uint8Array): void {
    for (const ws of this.#state.getWebSockets(`${WS_TAG_PREFIX}${playerId}`)) {
      try { ws.send(frame); } catch { /* closed */ }
    }
  }

  #broadcast(frame: Uint8Array, excludePlayerId: string | null): void {
    for (const ws of this.#state.getWebSockets()) {
      if (excludePlayerId !== null) {
        const tags = this.#state.getTags(ws);
        if (tags.includes(`${WS_TAG_PREFIX}${excludePlayerId}`)) continue;
      }
      try { ws.send(frame); } catch { /* closed */ }
    }
  }

  #sendSyncToAll(state: RoomState): void {
    for (const player of state.players) {
      this.#sendToPlayer(
        player.id,
        makeSyncState(
          state.phase,
          getOwnBoard(state, player.id),
          getEnemyBoard(state, player.id),
          [],
          state.currentTurnId === player.id,
          state.winnerId ?? undefined,
        ),
      );
    }
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  async #loadState(roomId?: string): Promise<RoomState> {
    const stored = await this.#state.storage.get<RoomState>(STATE_KEY);
    if (stored) return stored;
    return createRoomState(roomId ?? 'room');
  }

  async #saveState(state: RoomState): Promise<void> {
    await this.#state.storage.put(STATE_KEY, state);
  }
}