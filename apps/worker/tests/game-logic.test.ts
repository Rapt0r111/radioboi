import { describe, expect, test } from "bun:test";
import { makeCoordinate } from "@radioboi/game-core";
import {
  addPlayer,
  applyShipsPlaced,
  createRoomState,
  getEnemyBoard,
  getOpponentId,
  prepareAttack,
  processInterceptAttempt,
  recordMorseSequence,
  resolveHit,
  validateShipGeometry,
} from "../src/game-logic";
import { splitMorseSequence, validateMorseForCoord } from "../src/morse";

function validFleet() {
  return [
    { coords: [0, 1, 2, 3].map((col) => makeCoordinate(col, 0)) },
    { coords: [0, 1, 2].map((col) => makeCoordinate(col, 2)) },
    { coords: [0, 1, 2].map((col) => makeCoordinate(col, 4)) },
    { coords: [0, 1].map((col) => makeCoordinate(col, 6)) },
    { coords: [3, 4].map((col) => makeCoordinate(col, 6)) },
    { coords: [6, 7].map((col) => makeCoordinate(col, 6)) },
    { coords: [makeCoordinate(0, 8)] },
    { coords: [makeCoordinate(2, 8)] },
    { coords: [makeCoordinate(4, 8)] },
    { coords: [makeCoordinate(6, 8)] },
  ];
}

function roomReadyForBattle() {
  const state = createRoomState("ROOM42");
  addPlayer(state, { id: "p1", name: "P1", wsTag: "a", isReady: false });
  addPlayer(state, { id: "p2", name: "P2", wsTag: "b", isReady: false });
  applyShipsPlaced(state, "p1", validFleet());
  applyShipsPlaced(state, "p2", validFleet());
  state.currentTurnId = "p1";
  return state;
}

describe("room lifecycle", () => {
  test("moves from lobby to placement when the second player joins", () => {
    const state = createRoomState("ROOM42");

    expect(addPlayer(state, { id: "p1", name: "P1", wsTag: "a", isReady: false })).toEqual({
      ok: true,
    });
    expect(state.phase).toBe("lobby");
    expect(addPlayer(state, { id: "p2", name: "P2", wsTag: "b", isReady: false })).toEqual({
      ok: true,
    });
    expect(state.phase).toBe("placement");
    expect(getOpponentId(state, "p1")).toBe("p2");
  });

  test("rejects invalid fleets before mutating battle state", () => {
    expect(validateShipGeometry([{ coords: [makeCoordinate(0, 0), makeCoordinate(1, 1)] }])).toContain(
      "not linear",
    );
  });
});

describe("attack resolution", () => {
  test("records a miss, masks enemy ships, and passes the turn", () => {
    const state = roomReadyForBattle();
    const target = makeCoordinate(9, 9);

    expect(prepareAttack(state, "p1", target, "m1")).toEqual({ ok: true });
    expect(recordMorseSequence(state, "m1", [".", "-"])).toEqual({ ok: true });

    const result = processInterceptAttempt(state, "p2", "m1", target, 1, true);

    expect(result).toEqual({ result: "miss", isGameOver: false, winnerId: null });
    expect(state.currentTurnId).toBe("p2");
    expect(state.pendingAttacks).toEqual({});
    expect(getEnemyBoard(state, "p1")[target]).toBe("miss");
  });

  test("keeps the turn after a hit and sinks a single-cell ship", () => {
    const state = roomReadyForBattle();
    const target = makeCoordinate(0, 8);

    const result = resolveHit(state, "p1", target, "m2");

    expect(result.result).toBe("sunk");
    expect(state.currentTurnId).toBe("p1");
    expect(state.boards.p2?.[target]).toBe("sunk");
    expect(state.shotLog.at(-1)?.target).toBe(target);
  });
});

describe("worker Morse validation", () => {
  test("splits and validates coordinate Morse sequences", () => {
    const sequence = [".", "-", "-", "-", ".", ".", "."] as const;

    expect(splitMorseSequence(sequence)).toEqual([".-", "--..."]);
    expect(validateMorseForCoord([".", "-", "-", "-", ".", ".", "."], 0, 7)).toBe(true);
    expect(validateMorseForCoord([".", "-", "-", "-", ".", ".", "."], 1, 7)).toBe(false);
  });
});
