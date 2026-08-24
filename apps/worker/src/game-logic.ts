// apps/worker/src/game-logic.ts
//
// Pure, side-effect-free game logic for use inside GameRoomArbitrator.
//
// ASYNC MODE changes:
//   - pendingAttack → pendingAttacks: Record<attackerId, PendingAttack>
//   - prepareAttack skips turn check in async; checks cooldown instead
//   - resolveHit sets attackCooldown instead of toggling turns in async
//   - processInterceptAttempt finds attack across all pending attacks
//   - pendingAlarms[] array replaces single ALARM_TYPE_KEY storage

import {
  BOARD_COLUMN_LABELS,
  BOARD_ROW_LABELS,
  clampRoomSettings,
  COLUMNS,
  DEFAULT_ROOM_SETTINGS,
  isValidCoordinate,
  isValidMissileId,
  parseCoordinate as parseCoordCore,
  ROWS,
  type Coordinate,
  validatePlacement,
} from "@radioboi/game-core";

// ── Internal types ────────────────────────────────────────────────────────────

export type CellState = "ship" | "hit" | "miss" | "sunk" | "blocked";
export type Coord = string;
export type BoardMap = Record<Coord, CellState>;

export type ShipRecord = { coords: Coord[]; isSunk: boolean };

export type PlayerRecord = {
  id: string;
  name: string;
  wsTag: string;
  isReady: boolean;
  /**
   * Remaining offline allowance (ms). Shrinks only while disconnected.
   * Reconnect freezes the budget; the next disconnect resumes with what is left.
   */
  reconnectBudgetMs: number;
  /** Set when the player has no live sockets; null while connected. */
  disconnectedAt: number | null;
  /** Secret presented on reconnect. Empty on legacy seats until first post-upgrade connect. */
  seatToken: string;
};

export type PendingAttack = {
  attackerId: string;
  target: Coord;
  missileId: string;
  morseSequence: string[];
  attempts: number;
};

export type RoomPhase = "lobby" | "placement" | "battle" | "gameOver";

export type RoomSettings = {
  battleMode: "turn-based" | "async";
  difficulty: "beginner" | "normal" | "expert";
  attackCooldownMs: number;
  interceptWindowMs: number;
  maxInterceptAttempts: number;
};

export const DEFAULT_SETTINGS: RoomSettings = { ...DEFAULT_ROOM_SETTINGS };

export { clampRoomSettings };

export type PendingAlarm = {
  type: "intercept_timeout" | "attacker_turn_timeout" | "reconnect_timeout";
  /** Present for intercept_timeout */
  missileId?: string;
  /** Present for intercept_timeout — who attacked */
  attackerId?: string;
  /** Present for reconnect_timeout */
  playerId?: string;
  fireAt: number;
};

export type RoomState = {
  roomId: string;
  phase: RoomPhase;
  players: PlayerRecord[];
  boards: Record<string, BoardMap>;
  ships: Record<string, ShipRecord[]>;
  /** null in async mode (no turns), attacker's id in turn-based */
  currentTurnId: string | null;
  /** Keyed by attackerId — allows simultaneous attacks in async mode */
  pendingAttacks: Record<string, PendingAttack>;
  winnerId: string | null;
  shotLog: ShotLogEntry[];
  activeMissiles: Array<{ id: string; target: Coord; launchedAt: number }>;
  settings: RoomSettings;
  /** Async mode: playerId → unix ms when they may fire next */
  attackCooldowns: Record<string, number>;
  /** Sorted list of upcoming DO alarms */
  pendingAlarms: PendingAlarm[];
};

export type ShotLogEntry = {
  attackerId: string;
  target: Coord;
  result: "hit" | "miss" | "sunk";
  ts: number;
};

// ── Fleet definition ──────────────────────────────────────────────────────────



function secureRandomIndex(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError(`secureRandomIndex: invalid maxExclusive=${maxExclusive}`);
  }

  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const value = bytes[0];
  if (value === undefined) {
    throw new Error("secureRandomIndex: crypto.getRandomValues returned no data");
  }
  return value % maxExclusive;
}

// ── Column/row triplet definitions ────────────────────────────────────────────

function parseCoord(coord: string): { colIndex: number; rowIndex: number } | null {
  if (!isValidCoordinate(coord)) return null;
  return parseCoordCore(coord as Coordinate);
}

function coordFromIndices(colIndex: number, rowIndex: number): Coord | null {
  const col = COLUMNS[colIndex];
  const row = ROWS[rowIndex];
  return col && row ? col + row : null;
}

function getShipExclusionCoords(shipCoords: readonly Coord[]): Coord[] {
  const shipSet = new Set(shipCoords);
  const exclusion = new Set<Coord>();

  for (const coord of shipCoords) {
    const parsed = parseCoord(coord);
    if (!parsed) continue;

    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const nc = parsed.colIndex + dc;
        const nr = parsed.rowIndex + dr;
        if (nc < 0 || nc > 9 || nr < 0 || nr > 9) continue;
        const adjacent = coordFromIndices(nc, nr);
        if (adjacent && !shipSet.has(adjacent)) exclusion.add(adjacent);
      }
    }
  }

  return [...exclusion];
}

function markBlockedAroundSunkShip(board: BoardMap, shipCoords: readonly Coord[]): void {
  for (const coord of getShipExclusionCoords(shipCoords)) {
    if (board[coord] === undefined) board[coord] = "blocked";
  }
}

export function validateShipGeometry(
  ships: ReadonlyArray<{ coords: readonly string[] }>,
): string | null {
  const result = validatePlacement(
    ships.map((ship) => ({ coords: ship.coords as Coordinate[] })),
  );
  if (result.ok) return null;
  switch (result.error.kind) {
    case "INVALID_COORDINATE":
      return `Invalid coordinate: ${result.error.coord}`;
    case "SHIP_TOO_SHORT":
      return "Ship has no coordinates";
    case "SHIP_NOT_LINEAR":
      return `Ship ${result.error.shipIndex} is not linear`;
    case "SHIPS_OVERLAP":
      return "Ships overlap";
    case "SHIPS_TOUCH":
      return `Ships ${result.error.shipA} and ${result.error.shipB} are adjacent`;
    case "WRONG_FLEET":
      return `Invalid fleet: expected ${result.error.expected}, got ${result.error.got}`;
    default:
      return "INVALID_PLACEMENT";
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createRoomState(roomId: string, settings?: RoomSettings): RoomState {
  return {
    roomId,
    phase: "lobby",
    players: [],
    boards: {},
    ships: {},
    currentTurnId: null,
    pendingAttacks: {},
    winnerId: null,
    shotLog: [],
    activeMissiles: [],
    settings: { ...(settings ?? DEFAULT_SETTINGS) },
    attackCooldowns: {},
    pendingAlarms: [],
  };
}

// ── Player management ─────────────────────────────────────────────────────────

/**
 * Join or update a seat. Callers must pass a complete PlayerRecord
 * (use `makePlayerRecord` from player-presence for construction / legacy repair).
 */
export function addPlayer(
  state: RoomState,
  player: PlayerRecord,
): { ok: true } | { ok: false; reason: "ROOM_FULL" } {
  if (state.players.some((p) => p.id === player.id)) {
    const idx = state.players.findIndex((p) => p.id === player.id);
    const existing = state.players[idx];
    if (existing) {
      // Name/wsTag only — never reset reconnect budget or ready from a reconnect packet.
      state.players[idx] = {
        ...existing,
        name: player.name,
        wsTag: player.wsTag,
      };
    }
    return { ok: true };
  }
  if (state.players.length >= 2) return { ok: false, reason: "ROOM_FULL" };
  state.players.push(player);
  if (state.players.length === 2 && state.phase === "lobby") {
    state.phase = "placement";
  }
  return { ok: true };
}

export function getOpponentId(state: RoomState, playerId: string): string | null {
  return state.players.find((p) => p.id !== playerId)?.id ?? null;
}

/**
 * Move a seated player's identity to a new client id (refresh that rotated
 * playerId but still holds the seat token). Board/ship keys follow the seat.
 */
export function rebindPlayerId(state: RoomState, fromId: string, toId: string): boolean {
  if (fromId === toId) return true;
  if (state.players.some((player) => player.id === toId)) return false;
  const player = state.players.find((entry) => entry.id === fromId);
  if (!player) return false;

  player.id = toId;
  player.wsTag = `player:${toId}`;

  const board = state.boards[fromId];
  if (board !== undefined) {
    state.boards[toId] = board;
    delete state.boards[fromId];
  }
  const ships = state.ships[fromId];
  if (ships !== undefined) {
    state.ships[toId] = ships;
    delete state.ships[fromId];
  }
  const cooldown = state.attackCooldowns[fromId];
  if (cooldown !== undefined) {
    state.attackCooldowns[toId] = cooldown;
    delete state.attackCooldowns[fromId];
  }
  const attack = state.pendingAttacks[fromId];
  if (attack !== undefined) {
    attack.attackerId = toId;
    state.pendingAttacks[toId] = attack;
    delete state.pendingAttacks[fromId];
  }
  if (state.currentTurnId === fromId) state.currentTurnId = toId;
  if (state.winnerId === fromId) state.winnerId = toId;
  for (const entry of state.shotLog) {
    if (entry.attackerId === fromId) entry.attackerId = toId;
  }
  for (const alarm of state.pendingAlarms) {
    if (alarm.attackerId === fromId) alarm.attackerId = toId;
    if (alarm.playerId === fromId) alarm.playerId = toId;
  }
  return true;
}

/**
 * End battle with the opponent as winner (disconnect budget exhausted or surrender).
 * Returns winnerId or null if forfeit is not applicable.
 */
export function forfeitPlayer(state: RoomState, playerId: string): string | null {
  if (state.phase !== "battle") return null;
  const winnerId = getOpponentId(state, playerId);
  if (!winnerId) return null;

  state.phase = "gameOver";
  state.winnerId = winnerId;
  state.pendingAttacks = {};
  state.activeMissiles = [];
  state.currentTurnId = null;

  // Drop combat + reconnect alarms; room is settled.
  state.pendingAlarms = state.pendingAlarms.filter(
    (alarm) =>
      alarm.type !== "intercept_timeout" &&
      alarm.type !== "attacker_turn_timeout" &&
      alarm.type !== "reconnect_timeout",
  );

  const leaver = state.players.find((p) => p.id === playerId);
  if (leaver) {
    leaver.reconnectBudgetMs = 0;
    leaver.disconnectedAt = leaver.disconnectedAt ?? Date.now();
  }

  return winnerId;
}

// ── Ship placement ────────────────────────────────────────────────────────────

export function applyShipsPlaced(
  state: RoomState,
  playerId: string,
  ships: Array<{ coords: string[] }>,
): void {
  const board: BoardMap = {};
  const shipRecords: ShipRecord[] = [];
  for (const ship of ships) {
    for (const coord of ship.coords) board[coord] = "ship";
    shipRecords.push({ coords: ship.coords, isSunk: false });
  }
  state.boards[playerId] = board;
  state.ships[playerId]  = shipRecords;
  const player = state.players.find((p) => p.id === playerId);
  if (player) player.isReady = true;

  if (state.players.length === 2 && state.players.every((p) => p.isReady)) {
    state.phase = "battle";
    if (state.settings.battleMode === "turn-based") {
      const randomIdx = secureRandomIndex(state.players.length);
      state.currentTurnId = state.players[randomIdx]?.id ?? null;
    } else {
      // Async: no turns — both players start ready
      state.currentTurnId = null;
    }
  }
}

// ── Attack lifecycle ──────────────────────────────────────────────────────────

/** Returns how many ms remain on the cooldown (0 = ready) */
export function getCooldownRemaining(state: RoomState, playerId: string): number {
  const expires = state.attackCooldowns[playerId] ?? 0;
  return Math.max(0, expires - Date.now());
}

export function prepareAttack(
  state: RoomState,
  attackerId: string,
  target: Coord,
  missileId: string,
): { ok: true } | { ok: false; reason: string } {
  if (state.phase !== "battle") return { ok: false, reason: "GAME_NOT_STARTED" };
  if (!isValidCoordinate(target)) return { ok: false, reason: "INVALID_COORDINATE" };
  if (!isValidMissileId(missileId)) return { ok: false, reason: "INVALID_COORDINATE" };

  if (state.settings.battleMode === "turn-based") {
    if (state.currentTurnId !== attackerId) return { ok: false, reason: "NOT_YOUR_TURN" };
    // Turn-based: only one pending attack at a time (from anyone)
    if (Object.keys(state.pendingAttacks).length > 0) {
      return { ok: false, reason: "ATTACK_ALREADY_PENDING" };
    }
  } else {
    // Async: check cooldown
    const remaining = getCooldownRemaining(state, attackerId);
    if (remaining > 0) return { ok: false, reason: "ATTACK_ON_COOLDOWN" };
  }

  // Either mode: this player must not already have a pending attack
  if (state.pendingAttacks[attackerId]) {
    return { ok: false, reason: "ATTACK_ALREADY_PENDING" };
  }

  const opponentId = getOpponentId(state, attackerId);
  if (!opponentId) return { ok: false, reason: "NO_OPPONENT" };

  const opponentBoard = state.boards[opponentId] ?? {};
  const cellState = opponentBoard[target];
  if (
    cellState === "hit" ||
    cellState === "miss" ||
    cellState === "sunk" ||
    cellState === "blocked"
  ) {
    return { ok: false, reason: "CELL_ALREADY_SHOT" };
  }

  state.pendingAttacks[attackerId] = {
    attackerId,
    target,
    missileId,
    morseSequence: [],
    attempts: 0,
  };

  return { ok: true };
}

export function recordMorseSequence(
  state: RoomState,
  missileId: string,
  morseSequence: string[],
): { ok: true; cooldownExpiresAt?: number } | { ok: false; reason: string } {
  const attack = Object.values(state.pendingAttacks).find(
    (a) => a.missileId === missileId,
  );
  if (!attack) return { ok: false, reason: "NO_PENDING_ATTACK" };

  attack.morseSequence = morseSequence;
  state.activeMissiles.push({ id: missileId, target: attack.target, launchedAt: Date.now() });

  if (state.settings.battleMode === "async") {
    const cooldownExpiresAt = Date.now() + state.settings.attackCooldownMs;
    state.attackCooldowns[attack.attackerId] = cooldownExpiresAt;
    return { ok: true, cooldownExpiresAt };
  }

  return { ok: true };
}

export type ResolveResult = {
  result: "hit" | "miss" | "sunk";
  isGameOver: boolean;
  winnerId: string | null;
};

export type InterceptedResult = {
  intercepted: true;
  attackerId: string;
  target: Coord;
};

export type InterceptAttemptResult = ResolveResult | InterceptedResult;

export const MAX_INTERCEPT_ATTEMPTS = 3;

export function processInterceptAttempt(
  state: RoomState,
  defenderId: string,
  missileId: string,
  decodedCoord: Coord,
): InterceptAttemptResult | null {
  if (state.settings.battleMode === "async") return null;

  const attack = Object.values(state.pendingAttacks).find(
    (a) => a.missileId === missileId,
  );
  if (!attack) return null;
  if (attack.attackerId === defenderId) return null;

  attack.attempts += 1;
  const maxAttempts = state.settings.maxInterceptAttempts;
  const decodedCorrectly = decodedCoord === attack.target;

  if (decodedCorrectly) {
    const opponentId = getOpponentId(state, attack.attackerId);
    if (state.settings.battleMode === "turn-based" && opponentId && !state.winnerId) {
      state.currentTurnId = opponentId;
    }
    delete state.pendingAttacks[attack.attackerId];
    state.activeMissiles = state.activeMissiles.filter((m) => m.id !== missileId);
    state.pendingAlarms = state.pendingAlarms.filter(
      (a) => !(a.type === "intercept_timeout" && a.missileId === missileId),
    );
    return { intercepted: true, attackerId: attack.attackerId, target: attack.target };
  }

  if (attack.attempts < maxAttempts) return null;

  return resolveHit(state, attack.attackerId, attack.target, missileId);
}

export function resolveHit(
  state: RoomState,
  attackerId: string,
  target: Coord,
  missileId?: string,
): ResolveResult {
  const opponentId = getOpponentId(state, attackerId);
  if (!opponentId) return { result: "miss", isGameOver: false, winnerId: null };

  const existingBoard = state.boards[opponentId];
  const opponentBoard: BoardMap = existingBoard ?? {};
  if (!existingBoard) state.boards[opponentId] = opponentBoard;

  const opponentShips = state.ships[opponentId] ?? [];

  const wasShip =
    opponentBoard[target] === "ship" || opponentBoard[target] === undefined
      ? opponentShips.some((s) => s.coords.includes(target))
      : false;

  let result: "hit" | "miss" | "sunk";

  if (!wasShip) {
    opponentBoard[target] = "miss";
    result = "miss";
  } else {
    opponentBoard[target] = "hit";
    const ship = opponentShips.find((s) => s.coords.includes(target));
    if (ship) {
      const allHit = ship.coords.every(
        (c) => opponentBoard[c] === "hit" || opponentBoard[c] === "sunk",
      );
      if (allHit) {
        for (const c of ship.coords) opponentBoard[c] = "sunk";
        markBlockedAroundSunkShip(opponentBoard, ship.coords);
        ship.isSunk = true;
        result = "sunk";
      } else {
        result = "hit";
      }
    } else {
      result = "hit";
    }
  }

  state.shotLog.push({ attackerId, target, result, ts: Date.now() });

  const allSunk = opponentShips.length > 0 && opponentShips.every((s) => s.isSunk);
  const isGameOver = allSunk;
  const winnerId = isGameOver ? attackerId : null;

  if (isGameOver) {
    state.phase = "gameOver";
    state.winnerId = winnerId;
  }

  // ?? Turn management ???????????????????????????????????????????????????????
  if (state.settings.battleMode === "turn-based" && !isGameOver) {
    state.currentTurnId = result === "miss" ? opponentId : attackerId;
  }

  // Clear this attacker's pending entry
  delete state.pendingAttacks[attackerId];

  if (missileId !== undefined) {
    state.activeMissiles = state.activeMissiles.filter((m) => m.id !== missileId);
    // Remove pending alarm for this missile
    state.pendingAlarms = state.pendingAlarms.filter(
      (a) => !(a.type === "intercept_timeout" && a.missileId === missileId),
    );
  }

  return { result, isGameOver, winnerId };
}

// ── Alarm helpers ─────────────────────────────────────────────────────────────

export function addInterceptAlarm(
  state: RoomState,
  missileId: string,
  attackerId: string,
  interceptWindowMs: number,
): number {
  const fireAt = Date.now() + interceptWindowMs;
  state.pendingAlarms.push({
    type: "intercept_timeout",
    missileId,
    attackerId,
    fireAt,
  });
  // Keep sorted by fireAt ascending
  state.pendingAlarms.sort((a, b) => a.fireAt - b.fireAt);
  return fireAt;
}

export function addAttackerTurnAlarm(
  state: RoomState,
  attackerTurnTimeoutMs: number,
): void {
  // For turn-based: remove any existing attacker_turn_timeout first
  state.pendingAlarms = state.pendingAlarms.filter(
    (a) => a.type !== "attacker_turn_timeout",
  );
  state.pendingAlarms.push({
    type: "attacker_turn_timeout",
    fireAt: Date.now() + attackerTurnTimeoutMs,
  });
  state.pendingAlarms.sort((a, b) => a.fireAt - b.fireAt);
}

export function popExpiredAlarms(state: RoomState): PendingAlarm[] {
  const now = Date.now();
  const expired = state.pendingAlarms.filter((a) => a.fireAt <= now);
  state.pendingAlarms = state.pendingAlarms.filter((a) => a.fireAt > now);
  return expired;
}

export function nextAlarmAt(state: RoomState): number | null {
  return state.pendingAlarms[0]?.fireAt ?? null;
}

// ── Board projection helpers ──────────────────────────────────────────────────

export function getOwnBoard(state: RoomState, playerId: string): BoardMap {
  return state.boards[playerId] ?? {};
}

export function getEnemyBoard(state: RoomState, viewerId: string): BoardMap {
  const opponentId = getOpponentId(state, viewerId);
  if (!opponentId) return {};
  const full = state.boards[opponentId] ?? {};
  const masked: BoardMap = {};
  for (const [coord, cell] of Object.entries(full)) {
    if (cell === "hit" || cell === "miss" || cell === "sunk" || cell === "blocked") {
      masked[coord] = cell;
    }
  }
  return masked;
}

export function formatCoordForShotLog(coord: string): string {
  const parsed = parseCoord(coord);
  if (!parsed) return coord;
  const rowLabel = BOARD_ROW_LABELS[parsed.rowIndex] ?? String(parsed.rowIndex + 1);
  const colLabel = BOARD_COLUMN_LABELS[parsed.colIndex] ?? String(parsed.colIndex + 1);
  return `${rowLabel}${colLabel}`;
}

// Re-export for GameRoomArbitrator
export { isValidCoordinate, parseCoordCore as parseCoordinate };
