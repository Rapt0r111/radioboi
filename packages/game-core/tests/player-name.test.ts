import { describe, expect, test } from "bun:test";
import { normalizePlayerName, PLAYER_NAME_MAX_LENGTH } from "@radioboi/game-core";

describe("player names", () => {
  test("trims and collapses whitespace without breaking Unicode names", () => {
    expect(normalizePlayerName("  Моряк   Север  ")).toBe("Моряк Север");
  });

  test("rejects empty, control-character, and oversized names", () => {
    expect(normalizePlayerName("   ")).toBeNull();
    expect(normalizePlayerName("Pilot\n42")).toBeNull();
    expect(normalizePlayerName("x".repeat(PLAYER_NAME_MAX_LENGTH + 1))).toBeNull();
    expect(normalizePlayerName(null)).toBeNull();
  });
});
