// apps/worker/src/player-presence.ts
//
// Offline reconnect budget policy for a room seat.
// Sticky budget: disconnect starts (or continues) the clock; reconnect freezes
// remaining ms without refill; repeated flaps while offline do not reset.

import type { PlayerSummary } from "@radioboi/game-core";
import {
  generateSeatToken,
  isValidSeatToken,
  RECONNECT_BUDGET_MS,
} from "@radioboi/game-core";
import type { PlayerRecord, RoomState } from "./game-logic";
import { forfeitPlayer, rebindPlayerId } from "./game-logic";

export { generateSeatToken };

export type DisconnectMarkResult = {
  /**
   * True when state mutated and the caller should save + sync
   * (first offline transition, or offline budget already spent).
   * False for pure socket flaps while already offline with budget left.
   */
  shouldPersist: boolean;
  /** Absolute reconnect deadline while offline; null if unknown / no player. */
  deadlineAt: number | null;
  /** True when remaining budget is already zero — apply forfeit/remove now. */
  alreadyExpired: boolean;
};

export type ReconnectExpiryOutcome = "forfeit" | "removed" | "reschedule" | "noop";

// ── Player record ─────────────────────────────────────────────────────────────

function tokensEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

export function makePlayerRecord(
  partial: Pick<PlayerRecord, "id" | "name" | "wsTag"> & Partial<PlayerRecord>,
): PlayerRecord {
  return {
    id: partial.id,
    name: partial.name,
    wsTag: partial.wsTag,
    isReady: partial.isReady ?? false,
    reconnectBudgetMs: normalizeBudget(partial.reconnectBudgetMs),
    disconnectedAt: normalizeDisconnectedAt(partial.disconnectedAt),
    seatToken: typeof partial.seatToken === "string" ? partial.seatToken : "",
  };
}

/**
 * Existing seats require the issued token. Empty stored token is a one-shot
 * migration: mint a token and accept this connection.
 */
export function authenticateExistingSeat(
  player: PlayerRecord,
  presentedToken: string | null,
): { ok: true } | { ok: false; reason: "AUTH_FAILED" } {
  if (player.seatToken.length === 0) {
    player.seatToken =
      presentedToken !== null && isValidSeatToken(presentedToken)
        ? presentedToken
        : generateSeatToken();
    return { ok: true };
  }
  if (presentedToken === null || !tokensEqual(player.seatToken, presentedToken)) {
    return { ok: false, reason: "AUTH_FAILED" };
  }
  return { ok: true };
}

export function findSeatByToken(
  players: readonly PlayerRecord[],
  presentedToken: string | null,
): PlayerRecord | undefined {
  if (presentedToken === null || !isValidSeatToken(presentedToken)) return undefined;
  return players.find(
    (player) => player.seatToken.length > 0 && tokensEqual(player.seatToken, presentedToken),
  );
}

export type SeatClaim =
  | { kind: "reconnect"; player: PlayerRecord }
  | { kind: "join" }
  | { kind: "reject"; reason: "AUTH_FAILED" | "ROOM_FULL" };

/**
 * Resolve a WebSocket upgrade into an existing seat or a new join.
 * Token match wins over playerId so a refresh that rotated the client id
 * still reclaims the seat instead of hitting ROOM_FULL.
 */
export function claimSeat(
  state: RoomState,
  playerId: string,
  presentedToken: string | null,
): SeatClaim {
  const byToken = findSeatByToken(state.players, presentedToken);
  if (byToken) {
    if (byToken.id !== playerId && !rebindPlayerId(state, byToken.id, playerId)) {
      return { kind: "reject", reason: "AUTH_FAILED" };
    }
    return { kind: "reconnect", player: byToken };
  }

  const byId = state.players.find((player) => player.id === playerId);
  if (byId) {
    const auth = authenticateExistingSeat(byId, presentedToken);
    if (!auth.ok) return { kind: "reject", reason: "AUTH_FAILED" };
    return { kind: "reconnect", player: byId };
  }

  if (state.players.length >= 2) return { kind: "reject", reason: "ROOM_FULL" };
  return { kind: "join" };
}

export function seatTokenForJoin(presentedToken: string | null): string {
  if (presentedToken !== null && isValidSeatToken(presentedToken)) return presentedToken;
  return generateSeatToken();
}

/** Back-compat for DO storage written before presence fields existed. */
export function normalizePlayerRecord(player: PlayerRecord): PlayerRecord {
  return makePlayerRecord(player);
}

function normalizeBudget(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  return RECONNECT_BUDGET_MS;
}

function normalizeDisconnectedAt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

// ── Budget math ───────────────────────────────────────────────────────────────

export function remainingReconnectBudgetMs(
  player: PlayerRecord,
  now: number = Date.now(),
): number {
  if (player.disconnectedAt === null) return Math.max(0, player.reconnectBudgetMs);
  const elapsed = Math.max(0, now - player.disconnectedAt);
  return Math.max(0, player.reconnectBudgetMs - elapsed);
}

export function reconnectDeadlineAt(player: PlayerRecord): number | null {
  if (player.disconnectedAt === null) return null;
  return player.disconnectedAt + player.reconnectBudgetMs;
}

export function toRosterEntry(
  player: PlayerRecord,
  now: number = Date.now(),
): PlayerSummary {
  return {
    id: player.id,
    name: player.name,
    connected: player.disconnectedAt === null,
    reconnectBudgetMs: remainingReconnectBudgetMs(player, now),
    reconnectDeadlineAt: reconnectDeadlineAt(player),
  };
}

export function rosterFromPlayers(
  players: readonly PlayerRecord[],
  now: number = Date.now(),
): PlayerSummary[] {
  return players.map((player) => toRosterEntry(player, now));
}

// ── Alarms ────────────────────────────────────────────────────────────────────

export function purgePlayerAlarms(state: RoomState, playerId: string): void {
  state.pendingAlarms = state.pendingAlarms.filter(
    (alarm) =>
      alarm.attackerId !== playerId &&
      !(alarm.type === "reconnect_timeout" && alarm.playerId === playerId),
  );
}

export function clearReconnectAlarms(state: RoomState, playerId?: string): void {
  state.pendingAlarms = state.pendingAlarms.filter((alarm) => {
    if (alarm.type !== "reconnect_timeout") return true;
    if (playerId === undefined) return false;
    return alarm.playerId !== playerId;
  });
}

export function addReconnectAlarm(
  state: RoomState,
  playerId: string,
  fireAt: number,
): void {
  clearReconnectAlarms(state, playerId);
  state.pendingAlarms.push({
    type: "reconnect_timeout",
    playerId,
    fireAt,
  });
  state.pendingAlarms.sort((a, b) => a.fireAt - b.fireAt);
}

// ── Mark online / offline ─────────────────────────────────────────────────────

/**
 * Mark player offline. Sticky: if already offline, does not reset the clock.
 * `shouldPersist` is false for pure flaps (already offline, still has budget).
 *
 * When remaining budget is already 0 (e.g. reconnected at the last ms then left
 * again), still stamps `disconnectedAt` so applyReconnectTimeout can forfeit/remove.
 */
export function markPlayerDisconnected(
  state: RoomState,
  playerId: string,
  now: number = Date.now(),
): DisconnectMarkResult {
  // Settled games: ignore late closes — no budget / forfeit churn.
  if (state.phase === "gameOver") {
    return { shouldPersist: false, deadlineAt: null, alreadyExpired: false };
  }

  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return { shouldPersist: false, deadlineAt: null, alreadyExpired: false };
  }

  if (player.disconnectedAt !== null) {
    const left = remainingReconnectBudgetMs(player, now);
    if (left > 0) {
      // Pure flap while still within grace — no persist.
      return {
        shouldPersist: false,
        deadlineAt: reconnectDeadlineAt(player),
        alreadyExpired: false,
      };
    }
    // Past deadline while still marked offline: expire once (caller applies + saves).
    return {
      shouldPersist: true,
      deadlineAt: reconnectDeadlineAt(player),
      alreadyExpired: true,
    };
  }

  // First transition to offline.
  player.disconnectedAt = now;

  if (player.reconnectBudgetMs <= 0) {
    // No grace left — deadline is now; caller must applyReconnectTimeout.
    clearReconnectAlarms(state, playerId);
    return { shouldPersist: true, deadlineAt: now, alreadyExpired: true };
  }

  const deadlineAt = now + player.reconnectBudgetMs;
  addReconnectAlarm(state, playerId, deadlineAt);
  return { shouldPersist: true, deadlineAt, alreadyExpired: false };
}

/** Mark player online and freeze remaining budget (does not refill). */
export function markPlayerReconnected(
  state: RoomState,
  playerId: string,
  now: number = Date.now(),
): { changed: boolean; budgetLeft: number } {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { changed: false, budgetLeft: 0 };

  clearReconnectAlarms(state, playerId);

  if (player.disconnectedAt === null) {
    return { changed: false, budgetLeft: player.reconnectBudgetMs };
  }

  player.reconnectBudgetMs = remainingReconnectBudgetMs(player, now);
  player.disconnectedAt = null;
  return { changed: true, budgetLeft: player.reconnectBudgetMs };
}

// ── Expiry outcomes ───────────────────────────────────────────────────────────

export function removePlayer(state: RoomState, playerId: string): boolean {
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return false;

  state.players.splice(idx, 1);
  delete state.boards[playerId];
  delete state.ships[playerId];
  delete state.attackCooldowns[playerId];
  delete state.pendingAttacks[playerId];

  if (state.currentTurnId === playerId) state.currentTurnId = null;
  if (state.winnerId === playerId) state.winnerId = null;

  purgePlayerAlarms(state, playerId);

  if ((state.phase === "placement" || state.phase === "lobby") && state.players.length < 2) {
    state.phase = "lobby";
  }

  return true;
}

/**
 * Apply reconnect budget expiry for a still-offline player.
 * battle → forfeit (game-logic outcome); lobby/placement → free seat.
 */
export function applyReconnectTimeout(
  state: RoomState,
  playerId: string,
  now: number = Date.now(),
): ReconnectExpiryOutcome {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return "noop";

  if (player.disconnectedAt === null) {
    clearReconnectAlarms(state, playerId);
    return "noop";
  }

  const left = remainingReconnectBudgetMs(player, now);
  if (left > 0) {
    addReconnectAlarm(state, playerId, now + left);
    return "reschedule";
  }

  player.reconnectBudgetMs = 0;

  if (state.phase === "battle") {
    return forfeitPlayer(state, playerId) !== null ? "forfeit" : "noop";
  }

  if (state.phase === "lobby" || state.phase === "placement") {
    removePlayer(state, playerId);
    return "removed";
  }

  clearReconnectAlarms(state, playerId);
  return "noop";
}

/** Expire every offline seat whose budget is already spent. */
export function expireDisconnectedPlayers(
  state: RoomState,
  now: number = Date.now(),
): ReconnectExpiryOutcome[] {
  const offlineIds = state.players
    .filter((p) => p.disconnectedAt !== null && remainingReconnectBudgetMs(p, now) <= 0)
    .map((p) => p.id);

  return offlineIds.map((playerId) => applyReconnectTimeout(state, playerId, now));
}
