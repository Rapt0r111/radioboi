// apps/web/src/lib/clientSession.ts
//
// Client-side identity and lobby persistence for multi-window play.
//
// Strategy:
//   - playerId is tab-scoped (window.name + sessionStorage) so two windows can
//     be two different players in the same browser.
//   - playerName is dual-written: sessionStorage keeps this tab's nickname on
//     refresh; localStorage shares the last nickname across windows/tabs for
//     lobby prefill and direct room links.
//   - room settings are dual-written by roomId so the creator can reopen the
//     room from any window and still seed the WebSocket URL before KV catches up.

import {
  generateSeatToken,
  isValidPlayerId,
  isValidSeatToken,
  minimumAttackCooldownMs,
  normalizePlayerName,
  normalizeRoomId,
  type RoomSettings,
} from "@radioboi/game-core";

export const PLAYER_ID_KEY = "radioboi:playerId";
export const PLAYER_NAME_KEY = "radioboi:playerName";
export const TAB_ID_KEY = "radioboi:tabId";
export const TAB_NAME_PREFIX = "radioboi-tab:";
export const PLACED_KEY_PREFIX = "radioboi:placed:";
export const ROOM_SETTINGS_KEY_PREFIX = "radioboi:settings:";
export const SEAT_TOKEN_KEY_PREFIX = "radioboi:seat:";
export const SEATS_KEY_PREFIX = "radioboi:seats:";
/** A seat with no heartbeat for this long can be reclaimed after the tab is closed. */
export const SEAT_STALE_MS = 8_000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(kind: "local" | "session"): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readKey(storage: StorageLike | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(storage: StorageLike | null, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Storage is optional (private mode / quota).
  }
}

function removeKey(storage: StorageLike | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Create a UUID-ish client id without relying on crypto.randomUUID availability. */
export function createClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

/**
 * Stable tab identity via window.name (survives refresh in the same window).
 * New windows / tabs get a fresh id so they can join as a second player.
 */
export function getOrCreateTabId(): string {
  if (typeof window === "undefined") return createClientId();

  if (window.name.startsWith(TAB_NAME_PREFIX)) {
    return window.name.slice(TAB_NAME_PREFIX.length);
  }

  // Refresh can drop window.name (Next.js / some browsers). Reclaim this tab's
  // session id so we do not rotate playerId and hit ROOM_FULL.
  const storedTabId = readKey(browserStorage("session"), TAB_ID_KEY);
  if (storedTabId !== null && storedTabId.length > 0) {
    try {
      window.name = `${TAB_NAME_PREFIX}${storedTabId}`;
    } catch {
      // ignore
    }
    return storedTabId;
  }

  const next = createClientId();
  try {
    window.name = `${TAB_NAME_PREFIX}${next}`;
  } catch {
    // Some embeds block window.name assignment; fall through with ephemeral id.
  }
  return next;
}

/**
 * Tab-scoped player id. Bound to tabId so a duplicated tab that inherits
 * sessionStorage still gets a new identity when window.name differs.
 */
export function getOrCreatePlayerId(): string {
  const tabId = getOrCreateTabId();
  const session = browserStorage("session");
  const storedTabId = readKey(session, TAB_ID_KEY);
  const stored = readKey(session, PLAYER_ID_KEY);
  if (stored !== null && storedTabId === tabId) return stored;

  const next = createClientId();
  writeKey(session, TAB_ID_KEY, tabId);
  writeKey(session, PLAYER_ID_KEY, next);
  return next;
}

/**
 * Remember nickname for this tab (session) and as the browser-wide default (local).
 * Dual-write keeps refresh identity in multi-window play: each window has its own
 * session name, while a new window pre-fills from localStorage.
 */
export function rememberPlayerName(name: string): void {
  const normalized = normalizePlayerName(name);
  if (normalized === null) return;
  writeKey(browserStorage("session"), PLAYER_NAME_KEY, normalized);
  writeKey(browserStorage("local"), PLAYER_NAME_KEY, normalized);
}

/**
 * Preference order: this tab's session name ??? shared local name.
 * Used by the lobby form prefill and game-room connection.
 */
export function readPlayerNamePreference(): string | null {
  const sessionName = normalizePlayerName(readKey(browserStorage("session"), PLAYER_NAME_KEY));
  if (sessionName !== null) return sessionName;
  return normalizePlayerName(readKey(browserStorage("local"), PLAYER_NAME_KEY));
}

/**
 * Resolve the name to send on connect; falls back to a stable generated label.
 * When a real preference exists only in localStorage (other window), pin it into
 * this tab's sessionStorage so refresh keeps the same nickname without writing
 * generated fallbacks into the shared local default.
 */
export function resolvePlayerName(playerId: string): string {
  const preferred = readPlayerNamePreference();
  if (preferred !== null) {
    writeKey(browserStorage("session"), PLAYER_NAME_KEY, preferred);
    return preferred;
  }
  return `Player-${playerId.slice(0, 4)}`;
}

function parseRoomSettings(raw: string): RoomSettings | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<RoomSettings> & { beginnerMode?: boolean };
    const difficulty =
      parsed.difficulty === "beginner" ||
      parsed.difficulty === "normal" ||
      parsed.difficulty === "expert"
        ? parsed.difficulty
        : parsed.beginnerMode === true
          ? "beginner"
          : "normal";
    return {
      battleMode: parsed.battleMode === "async" ? "async" : "turn-based",
      difficulty,
      attackCooldownMs: Math.max(
        typeof parsed.attackCooldownMs === "number"
          ? parsed.attackCooldownMs
          : minimumAttackCooldownMs(difficulty),
        minimumAttackCooldownMs(difficulty),
      ),
      interceptWindowMs:
        typeof parsed.interceptWindowMs === "number" ? parsed.interceptWindowMs : 25_000,
      maxInterceptAttempts:
        typeof parsed.maxInterceptAttempts === "number" ? parsed.maxInterceptAttempts : 3,
    };
  } catch {
    return undefined;
  }
}

export function rememberRoomSettings(roomId: string, settings: Partial<RoomSettings>): void {
  const key = `${ROOM_SETTINGS_KEY_PREFIX}${roomId}`;
  const payload = JSON.stringify(settings);
  writeKey(browserStorage("session"), key, payload);
  writeKey(browserStorage("local"), key, payload);
}

export function readStoredRoomSettings(roomId: string): RoomSettings | undefined {
  const key = `${ROOM_SETTINGS_KEY_PREFIX}${roomId}`;
  const sessionRaw = readKey(browserStorage("session"), key);
  if (sessionRaw) {
    const fromSession = parseRoomSettings(sessionRaw);
    if (fromSession) return fromSession;
  }
  const localRaw = readKey(browserStorage("local"), key);
  if (localRaw) return parseRoomSettings(localRaw);
  return undefined;
}

export function markShipsPlaced(roomId: string): void {
  writeKey(browserStorage("session"), `${PLACED_KEY_PREFIX}${roomId}`, "1");
}

export function hasShipsPlaced(roomId: string): boolean {
  return readKey(browserStorage("session"), `${PLACED_KEY_PREFIX}${roomId}`) === "1";
}

export function clearShipsPlaced(roomId: string): void {
  removeKey(browserStorage("session"), `${PLACED_KEY_PREFIX}${roomId}`);
}

function roomKey(prefix: string, roomId: string): string {
  return `${prefix}${normalizeRoomId(roomId) ?? roomId.trim().toUpperCase()}`;
}

export function rememberSeatToken(roomId: string, token: string): void {
  if (token.length === 0) return;
  writeKey(browserStorage("session"), roomKey(SEAT_TOKEN_KEY_PREFIX, roomId), token);
}

export function readStoredSeatToken(roomId: string): string | undefined {
  const stored = readKey(browserStorage("session"), roomKey(SEAT_TOKEN_KEY_PREFIX, roomId));
  return stored && stored.length > 0 ? stored : undefined;
}

/** Create a room seat token before the first WebSocket frame, so remount/refresh can reconnect. */
export function getOrCreateSeatToken(roomId: string): string {
  const existing = readStoredSeatToken(roomId);
  if (existing !== undefined) return existing;
  const token = generateSeatToken();
  rememberSeatToken(roomId, token);
  return token;
}

export type RoomSeat = {
  playerId: string;
  seatToken: string;
  aliveAt: number;
};

function isRoomSeat(value: unknown): value is RoomSeat {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.playerId === "string" &&
    isValidPlayerId(entry.playerId) &&
    typeof entry.seatToken === "string" &&
    isValidSeatToken(entry.seatToken) &&
    typeof entry.aliveAt === "number" &&
    Number.isFinite(entry.aliveAt)
  );
}

function isStaleSeat(seat: RoomSeat, now: number): boolean {
  return seat.aliveAt <= 0 || now - seat.aliveAt >= SEAT_STALE_MS;
}

function readSeatLedger(roomId: string): RoomSeat[] {
  const raw = readKey(browserStorage("local"), roomKey(SEATS_KEY_PREFIX, roomId));
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRoomSeat);
  } catch {
    return [];
  }
}

function writeSeatLedger(roomId: string, seats: RoomSeat[]): void {
  writeKey(browserStorage("local"), roomKey(SEATS_KEY_PREFIX, roomId), JSON.stringify(seats));
}

function upsertSeat(roomId: string, seat: RoomSeat): void {
  const seats = readSeatLedger(roomId).filter(
    (entry) => entry.playerId !== seat.playerId && entry.seatToken !== seat.seatToken,
  );
  seats.push(seat);
  while (seats.length > 2) {
    const oldest = seats.reduce((current, entry) =>
      entry.aliveAt < current.aliveAt ? entry : current,
    );
    const index = seats.indexOf(oldest);
    if (index < 0) break;
    seats.splice(index, 1);
  }
  writeSeatLedger(roomId, seats);
}

function adoptSeatIntoTab(roomId: string, playerId: string, seatToken: string): void {
  const tabId = getOrCreateTabId();
  const session = browserStorage("session");
  writeKey(session, TAB_ID_KEY, tabId);
  writeKey(session, PLAYER_ID_KEY, playerId);
  rememberSeatToken(roomId, seatToken);
}

/**
 * Pick the identity to use for this tab in a room.
 *
 * Session identity wins (refresh). Otherwise a stale localStorage seat is
 * reclaimed so closing a tab and reopening the room does not hit ROOM_FULL.
 * A live second window still gets a new identity.
 */
export function claimRoomSeat(
  roomId: string,
  now: number = Date.now(),
): { playerId: string; seatToken: string } {
  const tabId = getOrCreateTabId();
  const session = browserStorage("session");
  const sessionPlayerId = readKey(session, PLAYER_ID_KEY);
  const sessionTabId = readKey(session, TAB_ID_KEY);
  const sessionToken = readStoredSeatToken(roomId);

  if (
    sessionPlayerId !== null &&
    sessionToken !== undefined &&
    sessionTabId === tabId
  ) {
    upsertSeat(roomId, { playerId: sessionPlayerId, seatToken: sessionToken, aliveAt: now });
    return { playerId: sessionPlayerId, seatToken: sessionToken };
  }

  const stale = [...readSeatLedger(roomId)].reverse().find((seat) => isStaleSeat(seat, now));
  if (stale !== undefined) {
    adoptSeatIntoTab(roomId, stale.playerId, stale.seatToken);
    upsertSeat(roomId, { playerId: stale.playerId, seatToken: stale.seatToken, aliveAt: now });
    return { playerId: stale.playerId, seatToken: stale.seatToken };
  }

  const playerId = getOrCreatePlayerId();
  const seatToken = getOrCreateSeatToken(roomId);
  upsertSeat(roomId, { playerId, seatToken, aliveAt: now });
  return { playerId, seatToken };
}

export function touchRoomSeat(
  roomId: string,
  playerId: string,
  seatToken: string,
  now: number = Date.now(),
): void {
  upsertSeat(roomId, { playerId, seatToken, aliveAt: now });
}

/** Mark the seat reclaimable immediately (tab close / leave room). */
export function releaseRoomSeat(roomId: string, playerId: string): void {
  writeSeatLedger(
    roomId,
    readSeatLedger(roomId).map((entry) =>
      entry.playerId === playerId ? { ...entry, aliveAt: 0 } : entry,
    ),
  );
}
