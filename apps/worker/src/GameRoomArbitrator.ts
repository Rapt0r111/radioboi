// apps/worker/src/GameRoomArbitrator.ts
//
// FIX (CRITICAL): #handleAttackerTimeout теперь ставит новый alarm для следующего
//   игрока. Без этого после первого таймаута игра замораживалась навсегда —
//   alarm больше не существовал, ход никогда не передавался следующему атакующему.
//
// FIX (HIGH): #sendSyncToAll теперь передаёт shotLog в SYNC_STATE.
//   Ранее история выстрелов терялась при реконнекте — syncFromServer получал
//   пустой список. Теперь сервер формирует log из перспективы каждого игрока
//   (by: "us"|"them") и включает его в снапшот.
//
// EXISTING FIXES (kept from original):
//   - extends DurableObject<Env> вместо implements (FIX HIGH)
//   - Серверная валидация геометрии кораблей в #handleShipsPlaced (FIX HIGH)
//   - PLAYER_JOINED не рассылается при реконнекте (FIX MEDIUM)
//   - Серверный таймаут хода атакующего (FIX MEDIUM)

import { DurableObject } from "cloudflare:workers";
import type { RoomPhase, RoomState } from "./game-logic";
import {
  addPlayer,
  applyShipsPlaced,
  createRoomState,
  getEnemyBoard,
  getOpponentId,
  getOwnBoard,
  MAX_INTERCEPT_ATTEMPTS,
  prepareAttack,
  processInterceptAttempt,
  recordMorseSequence,
  resolveHit,
  validateShipGeometry,
} from "./game-logic";
import { validateMorseForCoord } from "./morse";
import {
  decodeEvent,
  makeError,
  makeGameStarted,
  makeIncomingMissile,
  makePlayerJoined,
  makeResolveHit,
  makeSyncState,
} from "./protocol";
import type { Env } from "./types";

import { isValidCoordinate, parseCoordinate as parseCoordCore } from "@radioboi/game-core";

function coordToIndices(coord: string): { colIndex: number; rowIndex: number } | null {
  if (!isValidCoordinate(coord)) return null;
  return parseCoordCore(coord);
}

/** Форматирует координату для отображения: "АБВ005" → "АБВ-5" */
function formatCoordForShotLog(coord: string): string {
  const col = coord.slice(0, 3);
  const rowNum = Number(coord.slice(3, 6));
  return `${col}-${rowNum}`;
}

const STATE_KEY = "room:state";
const WS_TAG_PREFIX = "player:";
const ATTACKER_TURN_TIMEOUT_MS = 90_000;
const ALARM_TYPE_KEY = "alarm:type";
type AlarmType = "intercept_timeout" | "attacker_timeout";

export class GameRoomArbitrator extends DurableObject<Env> {

  // ── HTTP upgrade → WebSocket ───────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    const roomId = url.pathname.split("/").pop() ?? "unknown";
    const playerId = url.searchParams.get("playerId");
    const playerName = url.searchParams.get("playerName") ?? "Player";

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

    // Всегда шлём SYNC_STATE всем — клиент увидит актуальное состояние
    this.#sendSyncToAll(roomState);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── WebSocket event handlers (Hibernation API) ─────────────────────────────

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
    ws.close(code, reason);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    ws.close(1011, "WebSocket error");
  }

  // ── DO Alarm ───────────────────────────────────────────────────────────────

  override async alarm(): Promise<void> {
    const alarmType = await this.ctx.storage.get<AlarmType>(ALARM_TYPE_KEY);
    const state = await this.#loadState();

    if (alarmType === "attacker_timeout") {
      await this.#handleAttackerTimeout(state);
    } else {
      await this.#handleInterceptTimeout(state);
    }
  }

  // ── Attacker turn timeout ───────────────────────────────────────────────────

  async #handleAttackerTimeout(state: RoomState): Promise<void> {
    if (state.phase !== "battle" || state.pendingAttack !== null) return;
    const opponentId = state.currentTurnId
      ? getOpponentId(state, state.currentTurnId)
      : null;
    if (!opponentId) return;
    state.currentTurnId = opponentId;
    await this.#saveState(state);
    this.#sendSyncToAll(state);

    // FIX (CRITICAL): Ставим новый alarm для следующего игрока.
    // Без этого после первого таймаута ход никогда не передаётся снова —
    // alarm исчез, следующий атакующий может бездействовать вечно.
    if (state.phase === "battle") {
      await this.ctx.storage.put<AlarmType>(ALARM_TYPE_KEY, "attacker_timeout");
      await this.ctx.storage.setAlarm(Date.now() + ATTACKER_TURN_TIMEOUT_MS);
    }
  }

  // ── Intercept timeout (27s after MISSILE_LAUNCHED) ─────────────────────────

  async #handleInterceptTimeout(state: RoomState): Promise<void> {
    const attack = state.pendingAttack;
    if (!attack) return;

    const result = resolveHit(state, attack.attackerId, attack.target, attack.missileId);
    await this.#saveState(state);

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

    this.#sendSyncToAll(state);

    // Запускаем таймаут следующего хода
    if (!result.isGameOver && state.currentTurnId !== null) {
      await this.ctx.storage.put<AlarmType>(ALARM_TYPE_KEY, "attacker_timeout");
      await this.ctx.storage.setAlarm(Date.now() + ATTACKER_TURN_TIMEOUT_MS);
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

    const phaseAfterPlacement = state.phase as RoomPhase;

    if (phaseAfterPlacement === "battle") {
      const firstTurnId = state.currentTurnId;
      if (firstTurnId !== null) {
        this.#broadcast(makeGameStarted(firstTurnId), null);
      }
      this.#sendSyncToAll(state);
      await this.ctx.storage.put<AlarmType>(ALARM_TYPE_KEY, "attacker_timeout");
      await this.ctx.storage.setAlarm(Date.now() + ATTACKER_TURN_TIMEOUT_MS);
    } else {
      this.#sendToPlayer(
        playerId,
        makeSyncState(
          state.phase,
          getOwnBoard(state, playerId),
          getEnemyBoard(state, playerId),
          state.activeMissiles,
          state.currentTurnId === playerId,
          [],  // no shots yet in placement phase
          state.winnerId ?? undefined,
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
    // Атакующий начал атаку — снимаем таймаут хода
    await this.ctx.storage.deleteAlarm();
  }

  async #handleMissileLaunched(
    ws: WebSocket,
    playerId: string,
    payload: Record<string, unknown>,
    state: RoomState,
  ): Promise<void> {
    const missileId = payload.missileId;
    const target = payload.target;
    const morseSequence = payload.morseSequence;
    const timestamp = payload.timestamp;

    if (
      typeof missileId !== "string" ||
      typeof target !== "string" ||
      !Array.isArray(morseSequence) ||
      typeof timestamp !== "number"
    ) {
      ws.send(makeError("INVALID_COORDINATE", "Invalid MISSILE_LAUNCHED payload"));
      return;
    }

    const attack = state.pendingAttack;
    if (!attack || attack.missileId !== missileId || attack.attackerId !== playerId) {
      ws.send(makeError("NO_PENDING_ATTACK", "No matching ATTACK_PREP found"));
      return;
    }

    if (attack.target !== target) {
      state.pendingAttack = null;
      await this.#saveState(state);
      ws.send(makeError("INVALID_COORDINATE", "MISSILE_LAUNCHED target differs from ATTACK_PREP"));
      return;
    }

    const indices = coordToIndices(target);
    if (!indices) {
      state.pendingAttack = null;
      await this.#saveState(state);
      ws.send(makeError("INVALID_COORDINATE", `Invalid target coordinate: ${target}`));
      return;
    }

    if (!validateMorseForCoord(morseSequence as string[], indices.colIndex, indices.rowIndex)) {
      state.pendingAttack = null;
      await this.#saveState(state);
      ws.send(makeError("MORSE_MISMATCH", "Morse sequence does not match target coordinate"));
      return;
    }

    recordMorseSequence(state, missileId, morseSequence as string[]);
    await this.#saveState(state);

    await this.ctx.storage.put<AlarmType>(ALARM_TYPE_KEY, "intercept_timeout");
    await this.ctx.storage.setAlarm(Date.now() + 27_000);

    const opponentId = getOpponentId(state, playerId);
    if (opponentId) {
      this.#sendToPlayer(
        opponentId,
        makeIncomingMissile(
          missileId,
          morseSequence as string[],
          timestamp,
          MAX_INTERCEPT_ATTEMPTS,
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
    const missileId = payload.missileId;
    const decodedCoord = payload.decodedCoord;
    const attemptNumber = payload.attemptNumber;

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
      ws.send(makeError("MORSE_MISMATCH", "Incorrect decode — try again"));
      await this.#saveState(state);
      return;
    }

    await this.ctx.storage.deleteAlarm();
    await this.#saveState(state);

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

    this.#sendSyncToAll(state);

    if (!resolveResult.isGameOver && state.currentTurnId !== null) {
      await this.ctx.storage.put<AlarmType>(ALARM_TYPE_KEY, "attacker_timeout");
      await this.ctx.storage.setAlarm(Date.now() + ATTACKER_TURN_TIMEOUT_MS);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

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
   * Отправляет SYNC_STATE каждому игроку с правильной перспективой.
   *
   * FIX (HIGH): теперь включает shotLog — историю выстрелов, отформатированную
   * с точки зрения каждого игрока (by: "us"|"them"). До этого исправления
   * история выстрелов терялась при реконнекте, потому что SYNC_STATE её
   * не передавал, а syncFromServer затирал накопленный лог пустым массивом.
   */
  #sendSyncToAll(state: RoomState): void {
    for (const player of state.players) {
      const shotLog = state.shotLog.map((entry) => ({
        by: entry.attackerId === player.id ? "us" as const : "them" as const,
        coord: formatCoordForShotLog(entry.target),
        result: entry.result,
        ts: entry.ts,
      }));

      this.#sendToPlayer(
        player.id,
        makeSyncState(
          state.phase,
          getOwnBoard(state, player.id),
          getEnemyBoard(state, player.id),
          state.activeMissiles,
          state.currentTurnId === player.id,
          shotLog,
          state.winnerId ?? undefined,
        ),
      );
    }
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  async #loadState(roomId?: string): Promise<RoomState> {
    const stored = await this.ctx.storage.get<RoomState>(STATE_KEY);
    if (stored) return stored;
    return createRoomState(roomId ?? "room");
  }

  async #saveState(state: RoomState): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, state);
  }
}