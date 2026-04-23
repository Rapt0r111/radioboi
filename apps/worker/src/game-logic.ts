// apps/worker/src/game-logic.ts
// Pure, side-effect-free game logic for use inside GameRoomArbitrator.
// All functions are synchronous and operate on plain serialisable objects
// so that room state can be stored in Durable Object storage with no
// special serialisation code.
//
// Coordinate format used throughout: the full 6-char Cyrillic string,
// e.g. "АБВ000".  No branded type here — the Worker doesn't import
// @radioboi/game-core so it stays dependency-free.

// ── Internal types ────────────────────────────────────────────────────────────

export type CellState = "ship" | "hit" | "miss" | "sunk";
export type Coord = string; // 6-char Cyrillic coordinate string
export type BoardMap = Record<Coord, CellState>;

/** Serialisable representation of one ship on the board. */
export type ShipRecord = {
  /** All occupied coordinates (ordered). */
  coords: Coord[];
  /** True when every coord has been hit. */
  isSunk: boolean;
};

export type PlayerRecord = {
  id: string;
  name: string;
  /** WS hibernation tag stored as `player:<id>`. */
  wsTag: string;
  isReady: boolean; // ships placed?
};

export type PendingAttack = {
  attackerId: string;
  target: Coord;
  missileId: string;
  morseSequence: string[];
  attempts: number;
};

export type RoomPhase = "lobby" | "placement" | "battle" | "gameOver";

/**
 * Full game state persisted in Durable Object storage under key "state".
 * Stored as a plain JSON object — no class instances.
 */
export type RoomState = {
  roomId: string;
  phase: RoomPhase;
  players: PlayerRecord[]; // max 2
  boards: Record<string, BoardMap>; // playerId → board
  ships: Record<string, ShipRecord[]>; // playerId → ships
  currentTurnId: string | null;
  pendingAttack: PendingAttack | null;
  winnerId: string | null;
  /** Sequential shot log for history panel. */
  shotLog: ShotLogEntry[];
};

export type ShotLogEntry = {
  attackerId: string;
  target: Coord;
  result: "hit" | "miss" | "sunk";
  ts: number;
};

// ── Factory ───────────────────────────────────────────────────────────────────

export function createRoomState(roomId: string): RoomState {
  return {
    roomId,
    phase: "lobby",
    players: [],
    boards: {},
    ships: {},
    currentTurnId: null,
    pendingAttack: null,
    winnerId: null,
    shotLog: [],
  };
}

// ── Player management ─────────────────────────────────────────────────────────

export function addPlayer(
  state: RoomState,
  player: PlayerRecord,
): { ok: true } | { ok: false; reason: "ROOM_FULL" | "ALREADY_JOINED" } {
  if (state.players.some((p) => p.id === player.id)) {
    // Reconnect — update wsTag but don't duplicate.
    // FIX(noNonNullAssertion): extract element to a local variable and guard.
    const idx = state.players.findIndex((p) => p.id === player.id);
    const existing = state.players[idx];
    if (existing) {
      state.players[idx] = { ...existing, wsTag: player.wsTag };
    }
    return { ok: true };
  }
  if (state.players.length >= 2) {
    return { ok: false, reason: "ROOM_FULL" };
  }
  state.players.push(player);
  if (state.players.length === 2 && state.phase === "lobby") {
    state.phase = "placement";
  }
  return { ok: true };
}

export function getOpponentId(state: RoomState, playerId: string): string | null {
  return state.players.find((p) => p.id !== playerId)?.id ?? null;
}

// ── Ship placement ────────────────────────────────────────────────────────────

/**
 * Stores validated ship data for a player and marks them ready.
 * Caller is responsible for running validatePlacement before calling this.
 */
export function applyShipsPlaced(
  state: RoomState,
  playerId: string,
  ships: Array<{ coords: Coord[] }>,
): void {
  const board: BoardMap = {};
  const shipRecords: ShipRecord[] = [];

  for (const ship of ships) {
    for (const coord of ship.coords) {
      board[coord] = "ship";
    }
    shipRecords.push({ coords: ship.coords, isSunk: false });
  }

  state.boards[playerId] = board;
  state.ships[playerId] = shipRecords;

  const player = state.players.find((p) => p.id === playerId);
  if (player) player.isReady = true;

  // Both ready → move to battle.
  if (state.players.length === 2 && state.players.every((p) => p.isReady)) {
    state.phase = "battle";
    // FIX(noNonNullAssertion): use optional chaining; result is `string | undefined`.
    // At this point state.players.length === 2 so the player exists, but TS
    // cannot verify that through a dynamic index, so we fall back to null.
    const randomIdx = Math.random() < 0.5 ? 0 : 1;
    state.currentTurnId = state.players[randomIdx]?.id ?? null;
  }
}

// ── Attack lifecycle ──────────────────────────────────────────────────────────

/** Locks a target coordinate for the current attacker. */
export function prepareAttack(
  state: RoomState,
  attackerId: string,
  target: Coord,
  missileId: string,
): { ok: true } | { ok: false; reason: string } {
  if (state.phase !== "battle") return { ok: false, reason: "GAME_NOT_STARTED" };
  if (state.currentTurnId !== attackerId) return { ok: false, reason: "NOT_YOUR_TURN" };
  if (state.pendingAttack !== null) return { ok: false, reason: "ATTACK_ALREADY_PENDING" };

  const opponentId = getOpponentId(state, attackerId);
  if (!opponentId) return { ok: false, reason: "NO_OPPONENT" };

  const opponentBoard = state.boards[opponentId] ?? {};
  const cellState = opponentBoard[target];
  if (cellState === "hit" || cellState === "miss" || cellState === "sunk") {
    return { ok: false, reason: "CELL_ALREADY_SHOT" };
  }

  state.pendingAttack = {
    attackerId,
    target,
    missileId,
    morseSequence: [],
    attempts: 0,
  };

  return { ok: true };
}

/** Stores the Morse sequence; called after client-side Morse input. */
export function recordMorseSequence(
  state: RoomState,
  missileId: string,
  morseSequence: string[],
): { ok: true } | { ok: false; reason: string } {
  if (!state.pendingAttack || state.pendingAttack.missileId !== missileId) {
    return { ok: false, reason: "NO_PENDING_ATTACK" };
  }
  state.pendingAttack.morseSequence = morseSequence;
  return { ok: true };
}

export type ResolveResult = {
  result: "hit" | "miss" | "sunk";
  isGameOver: boolean;
  winnerId: string | null;
};

/** Max decode attempts before the server auto-resolves in the attacker's favour. */
export const MAX_INTERCEPT_ATTEMPTS = 3;

/**
 * Processes a defender's intercept attempt.
 *
 * @param decodedCoord  What the defender decoded.
 * @param forceResolve  True when max attempts exhausted — skip decode check.
 * @returns null if the attempt is wrong AND attempts remain; ResolveResult otherwise.
 *
 * FIX(noUnusedFunctionParameters): defenderId is intentionally unused — the
 * server validates the missile ID against the pending attack instead of the
 * player ID. Prefixed with _ to signal this is deliberate.
 */
export function processInterceptAttempt(
  state: RoomState,
  _defenderId: string,
  missileId: string,
  decodedCoord: Coord,
  attemptNumber: number,
  forceResolve: boolean,
): ResolveResult | null {
  const attack = state.pendingAttack;
  if (!attack || attack.missileId !== missileId) return null;

  attack.attempts = attemptNumber;

  const decodedCorrectly = forceResolve || decodedCoord === attack.target;

  if (!decodedCorrectly && attemptNumber < MAX_INTERCEPT_ATTEMPTS) {
    // Wrong decode, attempts remain — return null to let client retry
    return null;
  }

  // Resolve the hit regardless of decode accuracy
  return resolveHit(state, attack.attackerId, attack.target);
}

/**
 * Core hit-resolution logic.
 * Mutates the opponent's board in-place and clears pendingAttack.
 */
export function resolveHit(state: RoomState, attackerId: string, target: Coord): ResolveResult {
  // FIX(noNonNullAssertion): guard against null instead of using !
  // resolveHit is only called during battle phase (2 players present), so
  // opponentId is never null in practice. The guard satisfies TypeScript and
  // protects against future misuse.
  const opponentId = getOpponentId(state, attackerId);
  if (!opponentId) {
    // Unreachable in normal play — return a safe no-op result.
    return { result: "miss", isGameOver: false, winnerId: null };
  }

  // FIX(noAssignInExpressions): separate board initialisation from the read.
  // `state.boards[opponentId] ?? (state.boards[opponentId] = {})` is an
  // assignment inside an expression, which biome forbids as confusing.
  const existingBoard = state.boards[opponentId];
  const opponentBoard: BoardMap = existingBoard ?? {};
  if (!existingBoard) {
    state.boards[opponentId] = opponentBoard;
  }

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

    // Check if the ship is now sunk
    const ship = opponentShips.find((s) => s.coords.includes(target));
    if (ship) {
      const allHit = ship.coords.every(
        (c) => opponentBoard[c] === "hit" || opponentBoard[c] === "sunk",
      );
      if (allHit) {
        // Mark all cells of this ship as sunk
        for (const c of ship.coords) {
          opponentBoard[c] = "sunk";
        }
        ship.isSunk = true;
        result = "sunk";
      } else {
        result = "hit";
      }
    } else {
      result = "hit";
    }
  }

  // Log the shot
  state.shotLog.push({ attackerId, target, result, ts: Date.now() });

  // Check game over
  const allSunk = opponentShips.length > 0 && opponentShips.every((s) => s.isSunk);
  const isGameOver = allSunk;
  const winnerId = isGameOver ? attackerId : null;

  if (isGameOver) {
    state.phase = "gameOver";
    state.winnerId = winnerId;
  }

  // Advance turn (hit/sunk = attacker gets another turn; miss = opponent's turn)
  if (!isGameOver) {
    state.currentTurnId = result === "miss" ? opponentId : attackerId;
  }

  // Clear pending attack
  state.pendingAttack = null;

  return { result, isGameOver, winnerId };
}

// ── Board projection helpers ──────────────────────────────────────────────────

/**
 * Returns the board as seen by the OWNER (full info including ship positions).
 */
export function getOwnBoard(state: RoomState, playerId: string): BoardMap {
  return state.boards[playerId] ?? {};
}

/**
 * Returns the board as seen by the OPPONENT (hit/miss/sunk only — no ships).
 */
export function getEnemyBoard(state: RoomState, viewerId: string): BoardMap {
  const opponentId = getOpponentId(state, viewerId);
  if (!opponentId) return {};

  const full = state.boards[opponentId] ?? {};
  const masked: BoardMap = {};

  for (const [coord, cell] of Object.entries(full)) {
    if (cell === "hit" || cell === "miss" || cell === "sunk") {
      masked[coord] = cell;
    }
    // 'ship' cells are NOT included — opponent cannot see unshot ships
  }

  return masked;
}
