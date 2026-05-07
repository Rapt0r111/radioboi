// apps/worker/src/game-logic.ts
// Pure, side-effect-free game logic for use inside GameRoomArbitrator.
//
// FIX: Добавлена функция validateShipGeometry — серверная проверка геометрии
// флота. Ранее сервер принимал любые координаты без валидации перекрытий,
// касаний, нелинейности и состава флота. Это позволяло читерить через
// модифицированный клиент. Теперь #handleShipsPlaced вызывает validateShipGeometry
// перед applyShipsPlaced.

// ── Internal types ────────────────────────────────────────────────────────────

export type CellState = "ship" | "hit" | "miss" | "sunk";
export type Coord = string;
export type BoardMap = Record<Coord, CellState>;

export type ShipRecord = {
  coords: Coord[];
  isSunk: boolean;
};

export type PlayerRecord = {
  id: string;
  name: string;
  wsTag: string;
  isReady: boolean;
};

export type PendingAttack = {
  attackerId: string;
  target: Coord;
  missileId: string;
  morseSequence: string[];
  attempts: number;
};

export type RoomPhase = "lobby" | "placement" | "battle" | "gameOver";

export type RoomState = {
  roomId: string;
  phase: RoomPhase;
  players: PlayerRecord[];
  boards: Record<string, BoardMap>;
  ships: Record<string, ShipRecord[]>;
  currentTurnId: string | null;
  pendingAttack: PendingAttack | null;
  winnerId: string | null;
  shotLog: ShotLogEntry[];
  activeMissiles: Array<{ id: string; target: Coord; launchedAt: number }>;
};

export type ShotLogEntry = {
  attackerId: string;
  target: Coord;
  result: "hit" | "miss" | "sunk";
  ts: number;
};

// ── Fleet definition (mirrors @radioboi/game-core REQUIRED_FLEET) ─────────────

const REQUIRED_FLEET = new Map<number, number>([
  [4, 1],
  [3, 2],
  [2, 3],
  [1, 4],
]);

// ── Column/row triplet definitions (mirrors game-core COLUMNS/ROWS) ───────────

const COLUMNS = ["АБВ","ГДЕ","ЖЗИ","ЙКЛ","МНО","ПРС","ТУФ","ХЦЧ","ШЩЪ","ЫЭЮ"];
const ROWS = ["000","001","002","003","004","005","006","007","008","009"];
const COLUMN_SET = new Set<string>(COLUMNS);
const ROW_SET = new Set<string>(ROWS);

function parseCoord(coord: string): { colIndex: number; rowIndex: number } | null {
  if (coord.length !== 6) return null;
  const colStr = coord.slice(0, 3);
  const rowStr = coord.slice(3, 6);
  if (!COLUMN_SET.has(colStr) || !ROW_SET.has(rowStr)) return null;
  const colIndex = COLUMNS.indexOf(colStr);
  const rowIndex = ROWS.indexOf(rowStr);
  if (colIndex === -1 || rowIndex === -1) return null;
  return { colIndex, rowIndex };
}

// ── Server-side ship geometry validation ──────────────────────────────────────

/**
 * Validates ship geometry on the server:
 *  1. All coordinates are valid
 *  2. Each ship is linear (single row or column, contiguous)
 *  3. No overlapping cells between ships
 *  4. No adjacent cells (including diagonals) between ships
 *  5. Fleet composition matches REQUIRED_FLEET
 *
 * Returns null if valid, or an error message string if invalid.
 *
 * This mirrors the client-side validatePlacement from game-core,
 * but is self-contained so the worker doesn't depend on game-core.
 */
export function validateShipGeometry(
  ships: ReadonlyArray<{ coords: readonly string[] }>,
): string | null {
  // 1. Validate coordinates
  for (const ship of ships) {
    for (const coord of ship.coords) {
      if (!parseCoord(coord)) {
        return `Invalid coordinate: ${coord}`;
      }
    }
  }

  // 2. Linearity and length >= 1
  for (let i = 0; i < ships.length; i++) {
    const ship = ships[i];
    if (!ship || ship.coords.length < 1) return "Ship has no coordinates";

    if (ship.coords.length > 1) {
      const parsed = ship.coords.map(parseCoord).filter(Boolean) as Array<{colIndex: number; rowIndex: number}>;
      const first = parsed[0];
      if (!first) return "Ship parse failed";

      const allSameCol = parsed.every(p => p.colIndex === first.colIndex);
      const allSameRow = parsed.every(p => p.rowIndex === first.rowIndex);

      if (!allSameCol && !allSameRow) {
        return `Ship ${i} is not linear (not all same column or row)`;
      }

      // Check contiguity
      if (allSameCol) {
        const rows = parsed.map(p => p.rowIndex).sort((a, b) => a - b);
        for (let j = 1; j < rows.length; j++) {
          if ((rows[j] ?? 0) - (rows[j-1] ?? 0) !== 1) {
            return `Ship ${i} has gaps between cells`;
          }
        }
      } else {
        const cols = parsed.map(p => p.colIndex).sort((a, b) => a - b);
        for (let j = 1; j < cols.length; j++) {
          if ((cols[j] ?? 0) - (cols[j-1] ?? 0) !== 1) {
            return `Ship ${i} has gaps between cells`;
          }
        }
      }
    }
  }

  // 3. No overlaps
  const occupied = new Set<string>();
  for (const ship of ships) {
    for (const coord of ship.coords) {
      if (occupied.has(coord)) return `Ships overlap at ${coord}`;
      occupied.add(coord);
    }
  }

  // 4. No adjacency (including diagonals)
  for (let i = 0; i < ships.length; i++) {
    const shipI = ships[i];
    if (!shipI) continue;

    // Build exclusion zone for this ship
    const exclusion = new Set<string>();
    for (const coord of shipI.coords) {
      const p = parseCoord(coord);
      if (!p) continue;
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const nc = p.colIndex + dc;
          const nr = p.rowIndex + dr;
          if (nc >= 0 && nc <= 9 && nr >= 0 && nr <= 9) {
            const col = COLUMNS[nc];
            const row = ROWS[nr];
            if (col && row) exclusion.add(col + row);
          }
        }
      }
    }

    for (let j = i + 1; j < ships.length; j++) {
      const shipJ = ships[j];
      if (!shipJ) continue;
      for (const coord of shipJ.coords) {
        if (exclusion.has(coord)) {
          return `Ships ${i} and ${j} are adjacent or overlapping`;
        }
      }
    }
  }

  // 5. Fleet composition
  const actualFleet = new Map<number, number>();
  for (const ship of ships) {
    const len = ship.coords.length;
    actualFleet.set(len, (actualFleet.get(len) ?? 0) + 1);
  }

  for (const [len, count] of REQUIRED_FLEET) {
    if ((actualFleet.get(len) ?? 0) !== count) {
      return `Invalid fleet: expected ${count}×${len}-cell ship(s), got ${actualFleet.get(len) ?? 0}`;
    }
  }
  for (const len of actualFleet.keys()) {
    if (!REQUIRED_FLEET.has(len)) {
      return `Invalid fleet: unexpected ship of size ${len}`;
    }
  }

  return null; // valid
}

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
    activeMissiles: [],
  };
}

// ── Player management ─────────────────────────────────────────────────────────

export function addPlayer(
  state: RoomState,
  player: PlayerRecord,
): { ok: true } | { ok: false; reason: "ROOM_FULL" | "ALREADY_JOINED" } {
  if (state.players.some((p) => p.id === player.id)) {
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

export function applyShipsPlaced(
  state: RoomState,
  playerId: string,
  ships: Array<{ coords: string[] }>,
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

  if (state.players.length === 2 && state.players.every((p) => p.isReady)) {
    state.phase = "battle";
    const randomIdx = Math.random() < 0.5 ? 0 : 1;
    state.currentTurnId = state.players[randomIdx]?.id ?? null;
  }
}

// ── Attack lifecycle ──────────────────────────────────────────────────────────

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

export function recordMorseSequence(
  state: RoomState,
  missileId: string,
  morseSequence: string[],
): { ok: true } | { ok: false; reason: string } {
  if (!state.pendingAttack || state.pendingAttack.missileId !== missileId) {
    return { ok: false, reason: "NO_PENDING_ATTACK" };
  }
  state.pendingAttack.morseSequence = morseSequence;

  state.activeMissiles.push({
    id: missileId,
    target: state.pendingAttack.target,
    launchedAt: Date.now(),
  });

  return { ok: true };
}

export type ResolveResult = {
  result: "hit" | "miss" | "sunk";
  isGameOver: boolean;
  winnerId: string | null;
};

export const MAX_INTERCEPT_ATTEMPTS = 3;

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
    return null;
  }

  return resolveHit(state, attack.attackerId, attack.target, attack.missileId);
}

export function resolveHit(
  state: RoomState,
  attackerId: string,
  target: Coord,
  missileId?: string,
): ResolveResult {
  const opponentId = getOpponentId(state, attackerId);
  if (!opponentId) {
    return { result: "miss", isGameOver: false, winnerId: null };
  }

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

    const ship = opponentShips.find((s) => s.coords.includes(target));
    if (ship) {
      const allHit = ship.coords.every(
        (c) => opponentBoard[c] === "hit" || opponentBoard[c] === "sunk",
      );
      if (allHit) {
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

  state.shotLog.push({ attackerId, target, result, ts: Date.now() });

  const allSunk = opponentShips.length > 0 && opponentShips.every((s) => s.isSunk);
  const isGameOver = allSunk;
  const winnerId = isGameOver ? attackerId : null;

  if (isGameOver) {
    state.phase = "gameOver";
    state.winnerId = winnerId;
  }

  if (!isGameOver) {
    state.currentTurnId = result === "miss" ? opponentId : attackerId;
  }

  state.pendingAttack = null;

  if (missileId !== undefined) {
    state.activeMissiles = state.activeMissiles.filter((m) => m.id !== missileId);
  }

  return { result, isGameOver, winnerId };
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
    if (cell === "hit" || cell === "miss" || cell === "sunk") {
      masked[coord] = cell;
    }
  }

  return masked;
}