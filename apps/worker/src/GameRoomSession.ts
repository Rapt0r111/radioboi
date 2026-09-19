// Portable GameRoom session: same join/message/alarm logic as the Durable Object.
// Cloudflare wraps this with GameRoomArbitrator; the Node LAN server uses MemoryRoomHost.

import {
  ATTACKER_TURN_TIMEOUT_MS,
  FATAL_WS_CLOSE_CODE,
  FatalCloseReason,
  isValidPlayerId,
  normalizePlayerName,
  normalizeRoomId,
} from "@radioboi/game-core";
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
  applyReconnectTimeout,
  claimSeat,
  expireDisconnectedPlayers,
  findSeatByToken,
  makePlayerRecord,
  markPlayerDisconnected,
  markPlayerReconnected,
  normalizePlayerRecord,
  rosterFromPlayers,
  seatTokenForJoin,
} from "./player-presence";
import {
  type GameRoomBindings,
  type JoinParseResult,
  type JoinRequest,
  type RoomHost,
  type TaggedWebSocket,
  WS_OPEN,
  WS_TAG_PREFIX,
} from "./room-host";
import { isOriginAllowed, MessageRateLimiter } from "./security";
import {
  decodeEvent,
  makeAttackCooldownUpdate,
  makeError,
  makeGameStarted,
  makeIncomingMissile,
  makeMissileFired,
  makeMissileIntercepted,
  makePlayerJoined,
  makeResolveHit,
  makeSyncState,
} from "./protocol";
import { closeWebSocketSafely } from "./websocket";

function parseEncodedRoomSettings(encodedSettings?: string | null): RoomSettings | null {
  if (!encodedSettings) return null;
  try {
    return clampRoomSettings(JSON.parse(encodedSettings));
  } catch {
    return null;
  }
}

function canReconcileStoredSettings(state: RoomState): boolean {
  return (
    state.phase !== "gameOver" &&
    state.shotLog.length === 0 &&
    state.activeMissiles.length === 0 &&
    Object.keys(state.pendingAttacks).length === 0
  );
}

function roomSettingsDiffer(left: RoomSettings, right: RoomSettings): boolean {
  return (
    left.battleMode !== right.battleMode ||
    left.difficulty !== right.difficulty ||
    left.attackCooldownMs !== right.attackCooldownMs ||
    left.interceptWindowMs !== right.interceptWindowMs ||
    left.maxInterceptAttempts !== right.maxInterceptAttempts
  );
}

export class GameRoomSession {
  readonly #rateLimiter = new MessageRateLimiter();

  constructor(
    readonly host: RoomHost,
    readonly env: GameRoomBindings,
  ) {}

  parseJoin(requestUrl: string, origin: string | null): JoinParseResult {
    if (!isOriginAllowed(origin, this.env.ALLOWED_ORIGINS)) {
      return { ok: false, status: 403, body: "Origin not allowed" };
    }

    const url = new URL(requestUrl, "http://radioboi.local");
    const roomId = normalizeRoomId(url.pathname.split("/").pop() ?? "");
    const playerId = url.searchParams.get("playerId");
    const playerName = normalizePlayerName(url.searchParams.get("playerName")) ?? "Player";
    const presentedToken = url.searchParams.get("seatToken");
    const roomSettings = url.searchParams.get("settings");

    if (roomId === null) {
      return { ok: false, status: 400, body: "Invalid room id" };
    }
    if (playerId === null || !isValidPlayerId(playerId)) {
      return { ok: false, status: 400, body: "Invalid playerId query param" };
    }

    return {
      ok: true,
      join: {
        roomId,
        playerId,
        playerName,
        presentedToken,
        roomSettings,
      },
    };
  }

  async completeJoin(ws: TaggedWebSocket, join: JoinRequest): Promise<void> {
    this.host.acceptWebSocket(ws, [`${WS_TAG_PREFIX}${join.playerId}`]);

    const roomState = await this.#loadState(join.roomId, join.roomSettings);
    const now = Date.now();

    expireDisconnectedPlayers(roomState, now);

    const isSeatedPlayer =
      roomState.players.some((player) => player.id === join.playerId) ||
      findSeatByToken(roomState.players, join.presentedToken) !== undefined;
    if (roomState.phase === "gameOver" && !isSeatedPlayer) {
      ws.close(FATAL_WS_CLOSE_CODE, FatalCloseReason.GAME_OVER);
      return;
    }

    const claim = claimSeat(roomState, join.playerId, join.presentedToken);
    if (claim.kind === "reject") {
      ws.close(FATAL_WS_CLOSE_CODE, claim.reason);
      return;
    }

    const isReconnect = claim.kind === "reconnect";
    const playerRecord = makePlayerRecord({
      id: join.playerId,
      name: join.playerName,
      wsTag: `${WS_TAG_PREFIX}${join.playerId}`,
      isReady: isReconnect ? claim.player.isReady : false,
      seatToken: isReconnect ? claim.player.seatToken : seatTokenForJoin(join.presentedToken),
    });

    const addResult = addPlayer(roomState, playerRecord);

    if (!addResult.ok) {
      ws.close(FATAL_WS_CLOSE_CODE, addResult.reason);
      return;
    }

    const seated = roomState.players.find((player) => player.id === join.playerId);
    if (seated && seated.seatToken.length === 0) {
      seated.seatToken = playerRecord.seatToken;
    }

    for (const existing of this.host.getWebSockets(`${WS_TAG_PREFIX}${join.playerId}`)) {
      if (existing !== ws) {
        closeWebSocketSafely(existing, 1000, "Replaced by new connection");
      }
    }

    markPlayerReconnected(roomState, join.playerId, now);
    await this.#saveState(roomState);
    await this.#rescheduleAlarm(roomState);

    if (!isReconnect) {
      this.#broadcast(
        makePlayerJoined(join.playerId, join.playerName, roomState.players.length as 1 | 2),
        null,
      );
    }

    this.#sendSyncToAll(roomState);
    this.#sendPendingIncomingToPlayer(roomState, join.playerId);
  }

  async webSocketMessage(ws: TaggedWebSocket, raw: string | ArrayBuffer | ArrayBufferView): Promise<void> {
    const event = decodeEvent(raw);
    if (!event) return;

    const tag = this.host.getTags(ws).find((t) => t.startsWith(WS_TAG_PREFIX));
    if (!tag) return;
    const senderId = tag.slice(WS_TAG_PREFIX.length);
    if (!this.#rateLimiter.allow(senderId)) {
      ws.send(makeError("INTERNAL", "Too many messages"));
      return;
    }

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

  async webSocketClose(ws: TaggedWebSocket, code: number, reason: string): Promise<void> {
    closeWebSocketSafely(ws, code, reason);
    await this.#onPlayerSocketGone(ws);
  }

  async webSocketError(ws: TaggedWebSocket): Promise<void> {
    closeWebSocketSafely(ws, 1011, "WebSocket error");
  }

  #openSocketsFor(playerId: string, exclude: TaggedWebSocket | null = null): TaggedWebSocket[] {
    return this.host
      .getWebSockets(`${WS_TAG_PREFIX}${playerId}`)
      .filter((socket) => socket !== exclude && socket.readyState === WS_OPEN);
  }

  async #onPlayerSocketGone(ws: TaggedWebSocket): Promise<void> {
    const tag = this.host.getTags(ws).find((t) => t.startsWith(WS_TAG_PREFIX));
    if (!tag) return;
    const playerId = tag.slice(WS_TAG_PREFIX.length);

    if (this.#openSocketsFor(playerId, ws).length > 0) return;

    const state = await this.#loadState();
    if (state.phase === "gameOver") return;

    if (this.#openSocketsFor(playerId, ws).length > 0) return;

    const now = Date.now();
    const result = markPlayerDisconnected(state, playerId, now);
    if (result.alreadyExpired) {
      applyReconnectTimeout(state, playerId, now);
    }
    if (!result.shouldPersist) return;

    await this.#saveState(state);
    await this.#rescheduleAlarm(state);
    this.#sendSyncToAll(state);
  }

  async alarm(): Promise<void> {
    const state = await this.#loadState();
    const expired = popExpiredAlarms(state);
    let rosterMutated = false;

    for (const alarmEntry of expired) {
      if (alarmEntry.type === "intercept_timeout" && alarmEntry.missileId) {
        await this.#handleInterceptTimeout(state, alarmEntry.missileId, alarmEntry.attackerId);
      } else if (alarmEntry.type === "attacker_turn_timeout") {
        await this.#handleAttackerTimeout(state);
      } else if (alarmEntry.type === "reconnect_timeout" && alarmEntry.playerId) {
        const outcome = applyReconnectTimeout(state, alarmEntry.playerId);
        if (outcome === "forfeit" || outcome === "removed") {
          rosterMutated = true;
        }
      }
    }

    await this.#saveState(state);
    await this.#rescheduleAlarm(state);
    if (rosterMutated) {
      this.#sendSyncToAll(state);
    }
  }

  async #handleAttackerTimeout(state: RoomState): Promise<void> {
    if (state.phase !== "battle" || Object.keys(state.pendingAttacks).length > 0) return;
    const opponentId = state.currentTurnId
      ? getOpponentId(state, state.currentTurnId)
      : null;
    if (!opponentId) return;
    state.currentTurnId = opponentId;
    this.#sendSyncToAll(state);

    if (state.phase === "battle" && state.settings.battleMode === "turn-based") {
      addAttackerTurnAlarm(state, ATTACKER_TURN_TIMEOUT_MS);
    }
  }

  async #handleInterceptTimeout(
    state: RoomState,
    missileId: string,
    attackerId?: string,
  ): Promise<void> {
    const attack = attackerId
      ? state.pendingAttacks[attackerId]
      : Object.values(state.pendingAttacks).find((a) => a.missileId === missileId);

    if (!attack) return;

    const result = resolveHit(state, attack.attackerId, attack.target, attack.missileId);

    this.#broadcast(
      makeResolveHit(
        attack.missileId,
        attack.attackerId,
        attack.target,
        result.result,
        state.currentTurnId ?? attack.attackerId,
        result.isGameOver,
        false,
        result.winnerId ?? undefined,
      ),
      null,
    );

    this.#sendSyncToAll(state);

    if (!result.isGameOver && state.settings.battleMode === "turn-based" && state.currentTurnId) {
      addAttackerTurnAlarm(state, ATTACKER_TURN_TIMEOUT_MS);
    }
  }

  async #handleShipsPlaced(
    ws: TaggedWebSocket,
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
      if (state.settings.battleMode === "turn-based" && state.currentTurnId !== null) {
        this.#broadcast(makeGameStarted(state.currentTurnId), null);
        addAttackerTurnAlarm(state, ATTACKER_TURN_TIMEOUT_MS);
        await this.#saveState(state);
        await this.#rescheduleAlarm(state);
      } else if (state.settings.battleMode === "async") {
        this.#broadcast(makeGameStarted(""), null);
      }
      this.#sendSyncToAll(state);
    } else {
      this.#sendToPlayer(
        playerId,
        makeSyncState(
          state.phase,
          getOwnBoard(state, playerId),
          getEnemyBoard(state, playerId),
          this.#activeMissilesForPlayer(state, playerId),
          false,
          [],
          undefined,
          state.settings,
          undefined,
          rosterFromPlayers(state.players),
          state.players.find((player) => player.id === playerId)?.seatToken,
        ),
      );
    }
  }

  async #handleAttackPrep(
    ws: TaggedWebSocket,
    playerId: string,
    payload: Record<string, unknown>,
    state: RoomState,
  ): Promise<void> {
    const target = payload.target;
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

    if (state.settings.battleMode === "turn-based") {
      state.pendingAlarms = state.pendingAlarms.filter(
        (a) => a.type !== "attacker_turn_timeout",
      );
      await this.#saveState(state);
      await this.#rescheduleAlarm(state);
    }
  }

  async #handleMissileLaunched(
    ws: TaggedWebSocket,
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

    const recordResult = recordMorseSequence(state, missileId, morseSequence as string[]);
    if (!recordResult.ok) {
      ws.send(makeError(recordResult.reason, recordResult.reason));
      return;
    }

    if (state.settings.battleMode === "async") {
      const result = resolveHit(state, playerId, target, missileId);
      await this.#saveState(state);

      if (recordResult.cooldownExpiresAt !== undefined) {
        this.#sendToPlayer(playerId, makeAttackCooldownUpdate(recordResult.cooldownExpiresAt));
      }

      const opponentId = getOpponentId(state, playerId);
      if (opponentId) {
        this.#sendToPlayer(opponentId, makeMissileFired(missileId, playerId, timestamp as number));
      }

      this.#broadcast(
        makeResolveHit(
          missileId,
          playerId,
          target,
          result.result,
          state.currentTurnId ?? playerId,
          result.isGameOver,
          false,
          result.winnerId ?? undefined,
        ),
        null,
      );
      this.#sendSyncToAll(state);
      return;
    }

    const expiresAt = addInterceptAlarm(
      state,
      missileId,
      playerId,
      state.settings.interceptWindowMs,
    );

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
          expiresAt,
          attack.attempts,
        ),
      );
    }
  }

  async #handleInterceptAttempt(
    ws: TaggedWebSocket,
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

    if (state.settings.battleMode === "async") {
      ws.send(makeError("INTERCEPT_DISABLED", "Intercept is disabled in async mode"));
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

    await this.#saveState(state);
    await this.#rescheduleAlarm(state);

    if ("intercepted" in resolveResult) {
      this.#broadcast(
        makeMissileIntercepted(
          missileId,
          resolveResult.target,
          state.currentTurnId ?? playerId,
        ),
        null,
      );
      this.#sendSyncToAll(state);

      if (state.settings.battleMode === "turn-based" && state.currentTurnId !== null) {
        addAttackerTurnAlarm(state, ATTACKER_TURN_TIMEOUT_MS);
        await this.#saveState(state);
        await this.#rescheduleAlarm(state);
      }
      return;
    }

    const lastShot = state.shotLog[state.shotLog.length - 1];
    const shotTarget = lastShot?.target ?? "";
    const defenderDecodedCorrectly = decodedCoord === shotTarget;

    this.#broadcast(
      makeResolveHit(
        missileId,
        lastShot?.attackerId ?? playerId,
        shotTarget,
        resolveResult.result,
        state.currentTurnId ?? lastShot?.attackerId ?? playerId,
        resolveResult.isGameOver,
        defenderDecodedCorrectly,
        resolveResult.winnerId ?? undefined,
      ),
      null,
    );

    this.#sendSyncToAll(state);

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

  #activeMissilesForPlayer(state: RoomState, playerId: string): RoomState["activeMissiles"] {
    const ownMissileIds = new Set(
      Object.values(state.pendingAttacks)
        .filter((attack) => attack.attackerId === playerId)
        .map((attack) => attack.missileId),
    );

    return state.activeMissiles.map((missile) =>
      ownMissileIds.has(missile.id) ? missile : { ...missile, target: "" },
    );
  }

  #getInterceptExpiresAt(state: RoomState, missileId: string): number | undefined {
    return state.pendingAlarms.find(
      (alarm) => alarm.type === "intercept_timeout" && alarm.missileId === missileId,
    )?.fireAt;
  }

  #sendPendingIncomingToPlayer(state: RoomState, playerId: string): void {
    if (state.settings.battleMode === "async") return;

    const attack = Object.values(state.pendingAttacks).find(
      (pending) => pending.attackerId !== playerId && pending.morseSequence.length > 0,
    );
    if (!attack) return;

    this.#sendToPlayer(
      playerId,
      makeIncomingMissile(
        attack.missileId,
        attack.morseSequence,
        Date.now(),
        state.settings.maxInterceptAttempts,
        this.#getInterceptExpiresAt(state, attack.missileId),
        attack.attempts,
      ),
    );
  }

  #parseCoordIndices(coord: string): { colIndex: number; rowIndex: number } | null {
    if (!isValidCoordinate(coord)) return null;
    return parseCoordinate(coord);
  }

  #sendToPlayer(playerId: string, frame: Uint8Array): void {
    for (const socket of this.host.getWebSockets(`${WS_TAG_PREFIX}${playerId}`)) {
      try {
        socket.send(frame);
      } catch {
        /* closed */
      }
    }
  }

  #broadcast(frame: Uint8Array, excludePlayerId: string | null): void {
    for (const socket of this.host.getWebSockets()) {
      if (excludePlayerId !== null) {
        const tags = this.host.getTags(socket);
        if (tags.includes(`${WS_TAG_PREFIX}${excludePlayerId}`)) continue;
      }
      try {
        socket.send(frame);
      } catch {
        /* closed */
      }
    }
  }

  #sendSyncToAll(state: RoomState): void {
    const now = Date.now();
    for (const player of state.players) {
      const shotLog = state.shotLog.map((entry) => ({
        by: entry.attackerId === player.id ? ("us" as const) : ("them" as const),
        coord: formatCoordForShotLog(entry.target),
        result: entry.result,
        ts: entry.ts,
      }));

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
          this.#activeMissilesForPlayer(state, player.id),
          isMyTurn,
          shotLog,
          state.winnerId ?? undefined,
          state.settings,
          cooldownExpires !== undefined && cooldownExpires > now ? cooldownExpires : 0,
          rosterFromPlayers(state.players, now),
          player.seatToken,
        ),
      );
    }
  }

  async #rescheduleAlarm(state: RoomState): Promise<void> {
    const next = nextAlarmAt(state);
    await this.host.setAlarm(next);
  }

  async #loadState(roomId?: string, encodedSettings?: string | null): Promise<RoomState> {
    const stored = await this.host.getStoredState();
    if (stored) {
      if (!stored.pendingAlarms) stored.pendingAlarms = [];
      if (!stored.pendingAttacks) stored.pendingAttacks = {};
      if (!stored.activeMissiles) stored.activeMissiles = [];
      if (!stored.shotLog) stored.shotLog = [];
      if (!stored.attackCooldowns) stored.attackCooldowns = {};
      stored.players = (stored.players ?? []).map((player) => normalizePlayerRecord(player));
      stored.settings = stored.settings
        ? clampRoomSettings(stored.settings)
        : { ...DEFAULT_SETTINGS };
      const incomingSettings = parseEncodedRoomSettings(encodedSettings);
      if (
        incomingSettings &&
        stored.players.length === 0 &&
        canReconcileStoredSettings(stored) &&
        roomSettingsDiffer(stored.settings, incomingSettings)
      ) {
        stored.settings = incomingSettings;
        if (incomingSettings.battleMode === "async") {
          stored.currentTurnId = null;
          stored.pendingAlarms = [];
        }
        await this.host.putStoredState(stored);
      }
      return stored;
    }

    let settings: RoomSettings = DEFAULT_SETTINGS;
    const incomingSettings = parseEncodedRoomSettings(encodedSettings);
    if (incomingSettings) {
      settings = incomingSettings;
    } else if (roomId) {
      try {
        const raw = await this.host.getKvSettings(roomId);
        if (raw) settings = clampRoomSettings(JSON.parse(raw));
      } catch {
        /* use defaults */
      }
    }

    return createRoomState(roomId ?? "room", settings);
  }

  async #saveState(state: RoomState): Promise<void> {
    await this.host.putStoredState(state);
  }
}
