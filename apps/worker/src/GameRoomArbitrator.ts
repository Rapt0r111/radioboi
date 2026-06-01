// apps/worker/src/GameRoomArbitrator.ts
//
// KEY CHANGES for async mode:
//   - Loads RoomSettings from KV on first fetch (room creator stored them)
//   - #alarm() uses pendingAlarms[] — processes all expired alarms, then
//     re-schedules for the next earliest one (supports multiple missiles in flight)
//   - #handleMissileLaunched uses addInterceptAlarm() (no more ALARM_TYPE_KEY)
//   - #handleAttackPrep does NOT delete alarm — no attacker turn alarm in async
//   - After resolveHit, sends makeAttackCooldownUpdate to attacker in async mode
//   - #sendSyncToAll passes settings + per-player cooldown to each client

import { DurableObject } from "cloudflare:workers";
import type { RoomSettings, RoomState } from "./game-logic";
import {
  addAttackerTurnAlarm,
  addInterceptAlarm,
  addPlayer,
  applyShipsPlaced,
  clampRoomSettings,
  createRoomState,
  DEFAULT_SETTINGS,
  formatCoordForShotLog,
  getEnemyBoard,
  getOpponentId,
  getOwnBoard,
  isValidCoordinate,
  nextAlarmAt,
  parseCoordinate,
  popExpiredAlarms,
  prepareAttack,
  processInterceptAttempt,
  recordMorseSequence,
  resolveHit,
  validateShipGeometry,
} from "./game-logic";
import { validateMorseForCoord } from "./morse";
import {
  decodeEvent,
  makeAttackCooldownUpdate,
  makeError,
  makeGameStarted,
  makeIncomingMissile,
  makePlayerJoined,
  makeResolveHit,
  makeSyncState,
} from "./protocol";
import type { Env } from "./types";
import { closeWebSocketSafely } from "./websocket";

const STATE_KEY = "room:state";
const WS_TAG_PREFIX = "player:";
const ATTACKER_TURN_TIMEOUT_MS = 90_000;

export class GameRoomArbitrator extends DurableObject<Env> {

  // ── HTTP upgrade → WebSocket ───────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    const roomId = url.pathname.split("/").pop() ?? "unknown";
    const playerId     = url.searchParams.get("playerId");
    const playerName   = url.searchParams.get("playerName") ?? "Player";

    if (!playerId) {
      return new Response("Missing playerId query param", { status: 400 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [`${WS_TAG_PREFIX}${playerId}`]);

    const roomState = await this.#loadState(roomId);
    const isReconnect = roomState.players.some((p) => p.id === playerId);

    const addResult = addPlayer(roomState, {
      id: playerId,
      name: playerName,
      wsTag: `${WS_TAG_PREFIX}${playerId}`,
      isReady: roomState.players.find((p) => p.id === playerId)?.isReady ?? false,
    });

    if (!addResult.ok) {
      server.close(4001, addResult.reason);
      return new Response(null, { status: 101, webSocket: client });
    }

    await this.#saveState(roomState);

    if (!isReconnect) {
      this.#broadcast(
        makePlayerJoined(playerId, playerName, roomState.players.length as 1 | 2),
        null,
      );
    }

    this.#sendSyncToAll(roomState);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── WebSocket event handlers ───────────────────────────────────────────────

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const event = decodeEvent(raw);
    if (!event) return;

    const tag = this.ctx.getTags(ws).find((t) => t.startsWith(WS_TAG_PREFIX));
    if (!tag) return;
    const senderId = tag.slice(WS_TAG_PREFIX.length);

    const roomState = await this.#loadState();

    switch (event.type) {
      case "JOIN_ROOM":
        break;
      case "SHIPS_PLACED":
        await this.#handleShipsPlaced(ws, senderId, event.payload, roomState);
        break;
      case "ATTACK_PREP":
        await this.#handleAttackPrep(ws, senderId, event.payload, roomState);
        break;
      case "MISSILE_LAUNCHED":
        await this.#handleMissileLaunched(ws, senderId, event.payload, roomState);
        break;
      case "INTERCEPT_ATTEMPT":
        await this.#handleInterceptAttempt(ws, senderId, event.payload, roomState);
        break;
      default:
        ws.send(makeError("UNKNOWN_EVENT", `Unknown event type: ${event.type}`));
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    closeWebSocketSafely(ws, code, reason);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    closeWebSocketSafely(ws, 1011, "WebSocket error");
  }

  // ── DO Alarm — unified multi-alarm handler ─────────────────────────────────
  //
  // Uses pendingAlarms[] in state instead of a single ALARM_TYPE_KEY.
  // On each alarm fire:
  //   1. Pop all expired alarms from state.pendingAlarms
  //   2. Process each (intercept_timeout or attacker_turn_timeout)
  //   3. Re-schedule for the next earliest remaining alarm
  //
  // This allows simultaneous missiles in async mode (each has its own alarm).

  override async alarm(): Promise<void> {
    const state = await this.#loadState();
    const expired = popExpiredAlarms(state);

    for (const alarmEntry of expired) {
      if (alarmEntry.type === "intercept_timeout" && alarmEntry.missileId) {
        await this.#handleInterceptTimeout(state, alarmEntry.missileId, alarmEntry.attackerId);
      } else if (alarmEntry.type === "attacker_turn_timeout") {
        await this.#handleAttackerTimeout(state);
      }
    }

    await this.#saveState(state);
    await this.#rescheduleAlarm(state);
  }

  // ── Attacker turn timeout (turn-based only) ────────────────────────────────

  async #handleAttackerTimeout(state: RoomState): Promise<void> {
    if (state.phase !== "battle" || Object.keys(state.pendingAttacks).length > 0) return;
    const opponentId = state.currentTurnId
      ? getOpponentId(state, state.currentTurnId)
      : null;
    if (!opponentId) return;
    state.currentTurnId = opponentId;
    this.#sendSyncToAll(state);

    // Schedule alarm for the new attacker's turn
    if (state.phase === "battle" && state.settings.battleMode === "turn-based") {
      addAttackerTurnAlarm(state, ATTACKER_TURN_TIMEOUT_MS);
    }
  }

  // ── Intercept timeout ──────────────────────────────────────────────────────

  async #handleInterceptTimeout(
    state: RoomState,
    missileId: string,
    attackerId?: string,
  ): Promise<void> {
    // Find the pending attack
    const attack = attackerId
      ? state.pendingAttacks[attackerId]
      : Object.values(state.pendingAttacks).find((a) => a.missileId === missileId);

    if (!attack) return;

    const result = resolveHit(state, attack.attackerId, attack.target, attack.missileId);

    this.#broadcast(
      makeResolveHit(
        attack.missileId,
        attack.target,
        result.result,
        state.currentTurnId ?? attack.attackerId,
        result.isGameOver,
        false,
        result.winnerId ?? undefined,
      ),
      null,
    );

    // Async: send cooldown update to attacker
    if (state.settings.battleMode === "async" && result.cooldownExpiresAt !== undefined) {
      this.#sendToPlayer(attack.attackerId, makeAttackCooldownUpdate(result.cooldownExpiresAt));
    }

    this.#sendSyncToAll(state);

    // Turn-based: schedule next attacker's turn alarm
    if (!result.isGameOver && state.settings.battleMode === "turn-based" && state.currentTurnId) {
      addAttackerTurnAlarm(state, ATTACKER_TURN_TIMEOUT_MS);
    }
  }

  // ── Game event handlers ────────────────────────────────────────────────────

  async #handleShipsPlaced(
    ws: WebSocket,
    playerId: string,
    payload: Record<string, unknown>,
    state: RoomState,
  ): Promise<void> {
    if (state.phase !== "placement") {
      ws.send(makeError("GAME_NOT_STARTED", "Ship placement is not open"));
      return;
    }
    if (state.players.find((p) => p.id === playerId)?.isReady) {
      ws.send(makeError("INVALID_PLACEMENT", "Ships already placed"));
      return;
    }

    const ships = payload.ships;
    if (!Array.isArray(ships) || ships.length === 0) {
      ws.send(makeError("INVALID_PLACEMENT", "ships must be a non-empty array"));
      return;
    }

    const parsedShips: Array<{ coords: string[] }> = [];
    for (const ship of ships) {
      if (
        typeof ship !== "object" ||
        ship === null ||
        !Array.isArray((ship as Record<string, unknown>).coords)
      ) {
        ws.send(makeError("INVALID_PLACEMENT", "Each ship must have a coords array"));
        return;
      }
      const coords: string[] = [];
      for (const coord of (ship as { coords: unknown[] }).coords) {
        if (typeof coord !== "string" || !isValidCoordinate(coord)) {
          ws.send(makeError("INVALID_COORDINATE", `Invalid coordinate: ${String(coord)}`));
          return;
        }
        coords.push(coord);
      }
      parsedShips.push({ coords });
    }

    const geometryError = validateShipGeometry(parsedShips);
    if (geometryError !== null) {
      ws.send(makeError("INVALID_PLACEMENT", geometryError));
      return;
    }

    applyShipsPlaced(state, playerId, parsedShips);
    await this.#saveState(state);

    const phaseAfterPlacement = state.phase as RoomState["phase"];
    if (phaseAfterPlacement === "battle") {
      // Turn-based: announce first turn; async: no first turn
      if (state.settings.battleMode === "turn-based" && state.currentTurnId !== null) {
        this.#broadcast(makeGameStarted(state.currentTurnId), null);
        addAttackerTurnAlarm(state, ATTACKER_TURN_TIMEOUT_MS);
        await this.#saveState(state);
        await this.#rescheduleAlarm(state);
      } else if (state.settings.battleMode === "async") {
        // Broadcast a "game started" with empty firstTurnPlayerId to signal async mode
        this.#broadcast(makeGameStarted(""), null);
      }
      this.#sendSyncToAll(state);
    } else {
      // Only one player placed — send personal sync
      this.#sendToPlayer(
        playerId,
        makeSyncState(
          state.phase,
          getOwnBoard(state, playerId),
          getEnemyBoard(state, playerId),
          state.activeMissiles,
          false,
          [],
          undefined,
          state.settings,
          undefined,
        ),
      );
    }
  }

  async #handleAttackPrep(
    ws: WebSocket,
    playerId: string,
    payload: Record<string, unknown>,
    state: RoomState,
  ): Promise<void> {
    const target   = payload.target;
    const missileId = payload.missileId;

    if (typeof target !== "string" || typeof missileId !== "string") {
      ws.send(makeError("INVALID_COORDINATE", "target and missileId are required"));
      return;
    }

    const result = prepareAttack(state, playerId, target, missileId);
    if (!result.ok) {
      ws.send(makeError(result.reason, result.reason));
      return;
    }

    await this.#saveState(state);

    // Turn-based: cancel the attacker-turn alarm once they start attacking
    if (state.settings.battleMode === "turn-based") {
      state.pendingAlarms = state.pendingAlarms.filter(
        (a) => a.type !== "attacker_turn_timeout",
      );
      await this.#saveState(state);
      await this.#rescheduleAlarm(state);
    }
  }

  async #handleMissileLaunched(
    ws: WebSocket,
    playerId: string,
    payload: Record<string, unknown>,
    state: RoomState,
  ): Promise<void> {
    const { missileId, target, morseSequence, timestamp } = payload;

    if (
      typeof missileId !== "string" ||
      typeof target !== "string" ||
      !Array.isArray(morseSequence) ||
      typeof timestamp !== "number"
    ) {
      ws.send(makeError("INVALID_COORDINATE", "Invalid MISSILE_LAUNCHED payload"));
      return;
    }

    const attack = state.pendingAttacks[playerId];
    if (!attack || attack.missileId !== missileId) {
      ws.send(makeError("NO_PENDING_ATTACK", "No matching ATTACK_PREP found"));
      return;
    }

    if (attack.target !== target) {
      delete state.pendingAttacks[playerId];
      await this.#saveState(state);
      ws.send(makeError("INVALID_COORDINATE", "MISSILE_LAUNCHED target differs from ATTACK_PREP"));
      return;
    }

    const indices = this.#parseCoordIndices(target);
    if (!indices) {
      delete state.pendingAttacks[playerId];
      await this.#saveState(state);
      ws.send(makeError("INVALID_COORDINATE", `Invalid target: ${target}`));
      return;
    }

    if (!validateMorseForCoord(morseSequence as string[], indices.colIndex, indices.rowIndex)) {
      delete state.pendingAttacks[playerId];
      await this.#saveState(state);
      ws.send(makeError("MORSE_MISMATCH", "Morse sequence does not match target"));
      return;
    }

    recordMorseSequence(state, missileId, morseSequence as string[]);

    // Add intercept alarm using settings window
    addInterceptAlarm(state, missileId, playerId, state.settings.interceptWindowMs);

    await this.#saveState(state);
    await this.#rescheduleAlarm(state);

    const opponentId = getOpponentId(state, playerId);
    if (opponentId) {
      this.#sendToPlayer(
        opponentId,
        makeIncomingMissile(
          missileId,
          morseSequence as string[],
          timestamp as number,
          state.settings.maxInterceptAttempts,
        ),
      );
    }
  }

  async #handleInterceptAttempt(
    ws: WebSocket,
    playerId: string,
    payload: Record<string, unknown>,
    state: RoomState,
  ): Promise<void> {
    const { missileId, decodedCoord, attemptNumber } = payload;

    if (
      typeof missileId !== "string" ||
      typeof decodedCoord !== "string" ||
      typeof attemptNumber !== "number"
    ) {
      ws.send(makeError("INVALID_COORDINATE", "Invalid INTERCEPT_ATTEMPT payload"));
      return;
    }

    if (!isValidCoordinate(decodedCoord)) {
      ws.send(makeError("INVALID_COORDINATE", `Invalid coordinate: ${decodedCoord}`));
      return;
    }

    const resolveResult = processInterceptAttempt(
      state,
      playerId,
      missileId,
      decodedCoord,
    );

    if (resolveResult === null) {
      ws.send(makeError("MORSE_MISMATCH", "Incorrect decode — try again"));
      await this.#saveState(state);
      return;
    }

    // Remove intercept alarm for this missile (resolved early)
    state.pendingAlarms = state.pendingAlarms.filter(
      (a) => !(a.type === "intercept_timeout" && a.missileId === missileId),
    );

    await this.#saveState(state);
    await this.#rescheduleAlarm(state);

    const lastShot = state.shotLog[state.shotLog.length - 1];
    const shotTarget = lastShot?.target ?? "";
    const defenderDecodedCorrectly = decodedCoord === shotTarget;

    this.#broadcast(
      makeResolveHit(
        missileId,
        shotTarget,
        resolveResult.result,
        state.currentTurnId ?? lastShot?.attackerId ?? playerId,
        resolveResult.isGameOver,
        defenderDecodedCorrectly,
        resolveResult.winnerId ?? undefined,
      ),
      null,
    );

    // Async: send cooldown update to the attacker
    if (
      state.settings.battleMode === "async" &&
      resolveResult.cooldownExpiresAt !== undefined &&
      lastShot?.attackerId
    ) {
      this.#sendToPlayer(
        lastShot.attackerId,
        makeAttackCooldownUpdate(resolveResult.cooldownExpiresAt),
      );
    }

    this.#sendSyncToAll(state);

    // Turn-based: schedule next attacker's turn alarm
    if (
      !resolveResult.isGameOver &&
      state.settings.battleMode === "turn-based" &&
      state.currentTurnId !== null
    ) {
      addAttackerTurnAlarm(state, ATTACKER_TURN_TIMEOUT_MS);
      await this.#saveState(state);
      await this.#rescheduleAlarm(state);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  #parseCoordIndices(coord: string): { colIndex: number; rowIndex: number } | null {
    if (!isValidCoordinate(coord)) return null;
    return parseCoordinate(coord);
  }

  #sendToPlayer(playerId: string, frame: Uint8Array): void {
    for (const ws of this.ctx.getWebSockets(`${WS_TAG_PREFIX}${playerId}`)) {
      try { ws.send(frame); } catch { /* closed */ }
    }
  }

  #broadcast(frame: Uint8Array, excludePlayerId: string | null): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (excludePlayerId !== null) {
        const tags = this.ctx.getTags(ws);
        if (tags.includes(`${WS_TAG_PREFIX}${excludePlayerId}`)) continue;
      }
      try { ws.send(frame); } catch { /* closed */ }
    }
  }

  /**
   * Sends SYNC_STATE to each player with their own perspective.
   * Includes room settings and per-player cooldown (async mode).
   */
  #sendSyncToAll(state: RoomState): void {
    const now = Date.now();
    for (const player of state.players) {
      const shotLog = state.shotLog.map((entry) => ({
        by: entry.attackerId === player.id ? "us" as const : "them" as const,
        coord: formatCoordForShotLog(entry.target),
        result: entry.result,
        ts: entry.ts,
      }));

      // isMyTurn: true in turn-based when it's their turn;
      //           always false in async (no concept of "my turn")
      const isMyTurn =
        state.settings.battleMode === "turn-based"
          ? state.currentTurnId === player.id
          : false;

      const cooldownExpires =
        state.settings.battleMode === "async"
          ? (state.attackCooldowns[player.id] ?? 0)
          : undefined;

      this.#sendToPlayer(
        player.id,
        makeSyncState(
          state.phase,
          getOwnBoard(state, player.id),
          getEnemyBoard(state, player.id),
          state.activeMissiles,
          isMyTurn,
          shotLog,
          state.winnerId ?? undefined,
          state.settings,
          cooldownExpires !== undefined && cooldownExpires > now ? cooldownExpires : 0,
        ),
      );
    }
  }

  /** Sets DO alarm to the next pending alarm, or deletes it if none remain. */
  async #rescheduleAlarm(state: RoomState): Promise<void> {
    const next = nextAlarmAt(state);
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(next);
    }
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  async #loadState(roomId?: string): Promise<RoomState> {
    const stored = await this.ctx.storage.get<RoomState>(STATE_KEY);
    if (stored) {
      // Back-compat: older state without pendingAlarms / pendingAttacks
      if (!stored.pendingAlarms) stored.pendingAlarms = [];
      if (!stored.pendingAttacks) stored.pendingAttacks = {};
      if (!stored.attackCooldowns) stored.attackCooldowns = {};
      if (!stored.settings) stored.settings = DEFAULT_SETTINGS;
      return stored;
    }

    // First time: try to load settings from KV (set by room creator via lobby action)
    let settings: RoomSettings = DEFAULT_SETTINGS;
    if (roomId) {
      try {
        const raw = await this.env.ROOM_STATE.get(`settings:${roomId}`);
        if (raw) settings = clampRoomSettings(JSON.parse(raw));
      } catch { /* use defaults */ }
    }

    return createRoomState(roomId ?? "room", settings);
  }

  async #saveState(state: RoomState): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, state);
  }
}
