import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearShipsPlaced,
  getOrCreatePlayerId,
  hasShipsPlaced,
  markShipsPlaced,
  PLAYER_ID_KEY,
  PLAYER_NAME_KEY,
  readPlayerNamePreference,
  readStoredRoomSettings,
  rememberPlayerName,
  rememberRoomSettings,
  resolvePlayerName,
  TAB_ID_KEY,
  TAB_NAME_PREFIX,
} from "../src/lib/clientSession";

class MemoryStorage implements Storage {
  #map = new Map<string, string>();

  get length(): number {
    return this.#map.size;
  }

  clear(): void {
    this.#map.clear();
  }

  getItem(key: string): string | null {
    return this.#map.has(key) ? (this.#map.get(key) ?? null) : null;
  }

  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#map.set(key, value);
  }
}

function installBrowser(windowName = ""): {
  local: MemoryStorage;
  session: MemoryStorage;
  setName(name: string): void;
} {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  let name = windowName;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      get name() {
        return name;
      },
      set name(value: string) {
        name = value;
      },
      localStorage: local,
      sessionStorage: session,
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: local,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: session,
  });

  return {
    local,
    session,
    setName(next) {
      name = next;
    },
  };
}

describe("clientSession", () => {
  beforeEach(() => {
    installBrowser();
  });

  test("dual-writes nickname to session and local storage", () => {
    rememberPlayerName("  Моряк  ");

    expect(sessionStorage.getItem(PLAYER_NAME_KEY)).toBe("Моряк");
    expect(localStorage.getItem(PLAYER_NAME_KEY)).toBe("Моряк");
    expect(readPlayerNamePreference()).toBe("Моряк");
  });

  test("prefers this tab's session nickname over shared local nickname", () => {
    localStorage.setItem(PLAYER_NAME_KEY, "Локальный");
    sessionStorage.setItem(PLAYER_NAME_KEY, "Сессионный");

    expect(readPlayerNamePreference()).toBe("Сессионный");
  });

  test("falls back to localStorage when session has no nickname", () => {
    localStorage.setItem(PLAYER_NAME_KEY, "Моряк");

    expect(readPlayerNamePreference()).toBe("Моряк");
    expect(resolvePlayerName("abcdef12-....")).toBe("Моряк");
    // Pin shared name into this tab for refresh stability.
    expect(sessionStorage.getItem(PLAYER_NAME_KEY)).toBe("Моряк");
  });

  test("does not persist generated fallback nicknames to localStorage", () => {
    const name = resolvePlayerName("abcd1234-rest");
    expect(name).toBe("Player-abcd");
    expect(localStorage.getItem(PLAYER_NAME_KEY)).toBeNull();
    expect(sessionStorage.getItem(PLAYER_NAME_KEY)).toBeNull();
  });

  test("keeps playerId stable for the same window.name after refresh", () => {
    const first = getOrCreatePlayerId();
    const tabId = sessionStorage.getItem(TAB_ID_KEY);
    expect(tabId).not.toBeNull();
    expect(window.name).toBe(`${TAB_NAME_PREFIX}${tabId}`);
    expect(sessionStorage.getItem(PLAYER_ID_KEY)).toBe(first);

    // Simulate reload: session + window.name retained, new JS module load.
    const second = getOrCreatePlayerId();
    expect(second).toBe(first);
  });

  test("issues a new playerId when window.name (tab) differs", () => {
    const browser = installBrowser();
    const first = getOrCreatePlayerId();

    // New window: empty name, empty session.
    browser.setName("");
    browser.session.clear();

    const second = getOrCreatePlayerId();
    expect(second).not.toBe(first);
  });

  test("dual-writes room settings for multi-window creator reconnect", () => {
    rememberRoomSettings("ABC123", {
      battleMode: "async",
      difficulty: "expert",
      attackCooldownMs: 12_000,
      interceptWindowMs: 25_000,
      maxInterceptAttempts: 3,
    });

    // New window: only localStorage available.
    sessionStorage.clear();
    const settings = readStoredRoomSettings("ABC123");
    expect(settings).toMatchObject({
      battleMode: "async",
      difficulty: "expert",
      attackCooldownMs: 12_000,
    });
  });

  test("tracks ship placement only in session storage", () => {
    expect(hasShipsPlaced("ROOM01")).toBe(false);
    markShipsPlaced("ROOM01");
    expect(hasShipsPlaced("ROOM01")).toBe(true);
    expect(localStorage.getItem("radioboi:placed:ROOM01")).toBeNull();
    clearShipsPlaced("ROOM01");
    expect(hasShipsPlaced("ROOM01")).toBe(false);
  });
});
