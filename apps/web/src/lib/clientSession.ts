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
  minimumAttackCooldownMs,
  normalizePlayerName,
  type RoomSettings,
} from "@radioboi/game-core";

export const PLAYER_ID_KEY = "radioboi:playerId";
export const PLAYER_NAME_KEY = "radioboi:playerName";
export const TAB_ID_KEY = "radioboi:tabId";
export const TAB_NAME_PREFIX = "radioboi-tab:";
export const PLACED_KEY_PREFIX = "radioboi:placed:";
export const ROOM_SETTINGS_KEY_PREFIX = "radioboi:settings:";

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
