// apps/web/src/components/ShipPlacementScreen.tsx
"use client";
//
// FIX (HIGH): Устранено дублирование COLUMNS/ROWS — теперь импортируем из @radioboi/game-core.
// Раньше компонент определял COLS локально — при изменении координатной системы в
// game-core расстановка бы сломалась без ошибок компилятора (тихое расхождение).
//
// FIX (MEDIUM): randomPlacement теперь предупреждает если не удалось разместить корабль
// за 500 попыток — вместо тихого возврата частичного флота.
//
// FIX (MEDIUM): toggleOrientation показывает ошибку если поворот невозможен
// (корабль упирается в границу или в другой корабль).
//
// FIX (EXISTING, kept): validateGeometry для cell click / validatePlacement для Ready.

import {
  type Board,
  COLUMNS,
  type Coordinate,
  GameEventType,
  makeCoordinate,
  REQUIRED_FLEET,
  ROWS,
  validateGeometry,
  validatePlacement,
} from "@radioboi/game-core";
import { useCallback, useState } from "react";
import type { GameClient } from "@/src/lib/network/gameClient";
import { BoardGrid } from "./BoardGrid";

// ── Types ──────────────────────────────────────────────────────────────────────

type ShipId = string;

const SHIP_SEGMENT_KEYS = ["segment-1", "segment-2", "segment-3", "segment-4"] as const;

type PlacedShip = {
  id: ShipId;
  size: number;
  coords: Coordinate[];
  isHorizontal: boolean;
};

// ── Column/row index helpers (теперь используют COLUMNS/ROWS из game-core) ─────

function getColIndex(coord: Coordinate): number {
  return COLUMNS.indexOf(coord.slice(0, 3) as typeof COLUMNS[number]);
}

function getRowIndex(coord: Coordinate): number {
  return ROWS.indexOf(coord.slice(3, 6) as typeof ROWS[number]);
}

function cryptoRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError(`cryptoRandomInt: invalid maxExclusive=${maxExclusive}`);
  }
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const value = bytes[0];
  if (value === undefined) throw new Error("cryptoRandomInt: no random data");
  return value % maxExclusive;
}

// ── Fleet builder ──────────────────────────────────────────────────────────────

function buildFleet(): PlacedShip[] {
  const ships: PlacedShip[] = [];
  let counter = 0;
  const sorted = [...REQUIRED_FLEET.entries()].sort((a, b) => b[0] - a[0]);
  for (const [size, count] of sorted) {
    for (let i = 0; i < count; i++) {
      ships.push({ id: `ship-${size}-${counter++}`, size, coords: [], isHorizontal: true });
    }
  }
  return ships;
}

// ── Adjacent set ───────────────────────────────────────────────────────────────

function getAdjacentSet(coords: Coordinate[]): Set<Coordinate> {
  const result = new Set<Coordinate>();
  for (const coord of coords) {
    const ci = getColIndex(coord);
    const ri = getRowIndex(coord);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const nc = ci + dc;
        const nr = ri + dr;
        if (nc >= 0 && nc <= 9 && nr >= 0 && nr <= 9) {
          try { result.add(makeCoordinate(nc, nr)); } catch { /* ignore */ }
        }
      }
    }
  }
  return result;
}

// ── Random placement ───────────────────────────────────────────────────────────

/**
 * Случайно расставляет флот.
 * FIX: если корабль не удалось разместить за 500 попыток,
 * выбрасывает ошибку вместо тихого возврата частичного флота.
 */
function randomPlacement(): PlacedShip[] {
  const fleet = buildFleet();
  const occupied = new Set<Coordinate>();
  const forbidden = new Set<Coordinate>();

  for (const ship of fleet) {
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 500) {
      attempts++;
      const isH = cryptoRandomInt(2) === 0;
      const maxCol = isH ? 10 - ship.size : 9;
      const maxRow = isH ? 9 : 10 - ship.size;
      const sc = cryptoRandomInt(maxCol + 1);
      const sr = cryptoRandomInt(maxRow + 1);

      const coords: Coordinate[] = [];
      let valid = true;
      for (let i = 0; i < ship.size; i++) {
        const c = isH ? sc + i : sc;
        const r = isH ? sr : sr + i;
        try {
          const coord = makeCoordinate(c, r);
          if (occupied.has(coord) || forbidden.has(coord)) { valid = false; break; }
          coords.push(coord);
        } catch { valid = false; break; }
      }

      if (valid && coords.length === ship.size) {
        ship.coords = coords;
        ship.isHorizontal = isH;
        for (const coord of coords) occupied.add(coord);
        for (const adj of getAdjacentSet(coords)) forbidden.add(adj);
        placed = true;
      }
    }

    // FIX: явная ошибка вместо тихого частичного флота
    if (!placed) {
      throw new Error(
        `randomPlacement: не удалось разместить ${ship.size}-палубный за 500 попыток. Попробуйте ещё раз.`
      );
    }
  }
  return fleet;
}

// ── Build coords from anchor ───────────────────────────────────────────────────

function buildCoords(
  anchorCoord: Coordinate,
  size: number,
  isHorizontal: boolean,
): Coordinate[] | null {
  const ci = getColIndex(anchorCoord);
  const ri = getRowIndex(anchorCoord);
  const coords: Coordinate[] = [];
  for (let i = 0; i < size; i++) {
    const c = isHorizontal ? ci + i : ci;
    const r = isHorizontal ? ri : ri + i;
    if (c > 9 || r > 9) return null;
    try { coords.push(makeCoordinate(c, r)); } catch { return null; }
  }
  return coords;
}

// ── Board builder ──────────────────────────────────────────────────────────────

function buildBoard(ships: PlacedShip[]): Board {
  const board: Board = {} as Board;
  for (const ship of ships) {
    for (const coord of ship.coords) board[coord] = "ship";
  }
  return board;
}

function findShipByCoord(ships: readonly PlacedShip[], coord: Coordinate): PlacedShip | null {
  return ships.find((ship) => ship.coords.includes(coord)) ?? null;
}

// ── Props ──────────────────────────────────────────────────────────────────────

type Props = {
  transport: GameClient | null;
  playerId: string | null;
  onPlaced: () => void;
};

// ── Component ──────────────────────────────────────────────────────────────────

export function ShipPlacementScreen({ transport, playerId: _playerId, onPlaced }: Props) {
  const [ships, setShips] = useState<PlacedShip[]>(() => {
    try { return randomPlacement(); } catch { return buildFleet(); }
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedShipId, setSelectedShipId] = useState<ShipId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const board = buildBoard(ships);
  const allPlaced = ships.every((s) => s.coords.length === s.size);
  const selectedShip = selectedShipId
    ? ships.find((ship) => ship.id === selectedShipId) ?? null
    : null;
  const highlightedCoords = selectedShip?.coords ?? [];

  const handleCellClick = useCallback((coord: Coordinate) => {
    const existingShip = findShipByCoord(ships, coord);
    if (!selectedShipId) {
      if (existingShip) {
        setSelectedShipId(existingShip.id);
        setError(null);
      }
      return;
    }

    if (existingShip?.id === selectedShipId) {
      setSelectedShipId(null);
      setError(null);
      return;
    }

    setShips((prev) => {
      const ship = prev.find((s) => s.id === selectedShipId);
      if (!ship) return prev;
      const newCoords = buildCoords(coord, ship.size, ship.isHorizontal);
      if (!newCoords) { setError("Корабль выходит за границы поля"); return prev; }
      const updated = prev.map((s) => s.id === selectedShipId ? { ...s, coords: newCoords } : s);
      const toValidate = updated.filter((s) => s.coords.length > 0).map((s) => ({ coords: s.coords }));
      const result = validateGeometry(toValidate);
      if (!result.ok) { setError("Нельзя: корабли пересекаются или соприкасаются"); return prev; }
      setError(null);
      return updated;
    });
  }, [selectedShipId, ships]);

  const toggleOrientation = useCallback((id: ShipId) => {
    setShips((prev) => {
      const updated = prev.map((s) => {
        if (s.id !== id) return s;
        const isH = !s.isHorizontal;
        if (s.coords.length === 0) return { ...s, isHorizontal: isH };
        const first = s.coords[0];
        if (!first) return s;
        const newCoords = buildCoords(first, s.size, isH);
        if (!newCoords) {
          // FIX: устанавливаем ошибку — поворот невозможен (выходит за границу)
          setError("Поворот невозможен: корабль выходит за границу");
          return s;
        }
        return { ...s, isHorizontal: isH, coords: newCoords };
      });
      const toValidate = updated.filter((s) => s.coords.length > 0).map((s) => ({ coords: s.coords }));
      if (!validateGeometry(toValidate).ok) {
        setError("Поворот невозможен: корабли соприкасаются");
        return prev;
      }
      setError(null);
      return updated;
    });
  }, []);

  const removeShip = useCallback((id: ShipId) => {
    setShips((prev) => prev.map((s) => s.id === id ? { ...s, coords: [] } : s));
    setSelectedShipId(null);
    setError(null);
  }, []);

  const clearFleet = useCallback(() => {
    setShips((prev) => prev.map((ship) => ({ ...ship, coords: [] })));
    setSelectedShipId(null);
    setError(null);
  }, []);

  const handleReady = () => {
    if (!transport || !allPlaced || isSubmitting) return;
    const toValidate = ships.map((s) => ({ coords: s.coords }));
    if (!validatePlacement(toValidate).ok) { setError("Расстановка невалидна"); return; }
    setIsSubmitting(true);
    transport.send({
      type: GameEventType.SHIPS_PLACED,
      payload: { ships: ships.map((s) => ({ coords: s.coords })) },
    });
    onPlaced();
  };

  const handleRandomize = () => {
    try {
      setShips(randomPlacement());
      setSelectedShipId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка случайной расстановки");
    }
  };

  const unplaced = ships.filter((s) => s.coords.length === 0);
  const placed = ships.filter((s) => s.coords.length > 0);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-start gap-6 px-4 py-8 bg-ocean-950 text-miss-white">
      <header className="text-center">
        <h1
          className="font-mono text-2xl font-bold tracking-[0.2em] text-radar-green"
          style={{ textShadow: "0 0 12px rgba(0,255,136,0.4)" }}
        >
          ▸ РАССТАНОВКА ФЛОТА
        </h1>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-miss-white/40">
          Выбери корабль из ангара → кликни клетку · ↔↕ поворот · ✕ убрать
        </p>
      </header>

      {error && (
        <div className="rounded border border-hit-red/50 bg-hit-red/10 px-4 py-2 font-mono text-xs text-hit-red uppercase tracking-widest">
          ✕ {error}
        </div>
      )}

      <div className="flex w-full max-w-5xl flex-col gap-6 lg:flex-row lg:items-start">

        {/* ── Доска ─────────────────────────────────────────────────── */}
        <div className="rounded border border-ocean-800 bg-ocean-900/80 p-4">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-radar-green/60">
            Ваш сектор
            {selectedShipId && (
              <span className="ml-2 text-morse-amber">
                — кликните на клетку для размещения
              </span>
            )}
          </h2>
          <BoardGrid
            board={board}
            isEnemy={false}
            isPlacement
            highlightedCoords={highlightedCoords}
            onCellClick={handleCellClick}
          />
        </div>

        {/* ── Панель ────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 min-w-65">

          {unplaced.length > 0 && (
            <div className="rounded border border-ocean-800 bg-ocean-900/80 p-4">
              <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-morse-amber/70">
                АНГАР ({unplaced.length})
              </h2>
              <div className="flex flex-col gap-1.5">
                {unplaced.map((ship) => {
                  const isSelected = selectedShipId === ship.id;
                  return (
                    <div key={ship.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => { setSelectedShipId(isSelected ? null : ship.id); setError(null); }}
                        className={`
                          flex flex-1 items-center gap-3 rounded border px-3 py-2
                          font-mono text-xs cursor-pointer select-none
                          transition-colors duration-100 text-left
                          ${isSelected
                            ? "border-radar-green bg-radar-green/10 text-radar-green"
                            : "border-ocean-800 text-miss-white/60 hover:border-ocean-700 hover:text-miss-white/80"
                          }
                        `}
                      >
                        <div className={`flex ${ship.isHorizontal ? "flex-row" : "flex-col"} gap-0.5 shrink-0`}>
                          {SHIP_SEGMENT_KEYS.slice(0, ship.size).map((segmentKey) => (
                            <div key={segmentKey} className="h-3 w-3 rounded-[1px] bg-current opacity-80" />
                          ))}
                        </div>
                        <span className="flex-1 uppercase tracking-widest text-[9px]">
                          {ship.size}-палубный
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleOrientation(ship.id)}
                        className="rounded border border-ocean-800 px-2 py-2 font-mono text-[11px] text-miss-white/40 hover:text-miss-white/80 transition-opacity"
                        title="Повернуть"
                      >
                        {ship.isHorizontal ? "↔" : "↕"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {placed.length > 0 && (
            <div className="rounded border border-ocean-800 bg-ocean-900/80 p-4">
              <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-radar-green/50">
                НА ПОЗИЦИИ ({placed.length}/{ships.length})
              </h2>
              <div className="flex flex-col gap-1.5">
                {placed.map((ship) => (
                  <div
                    key={ship.id}
                    className="flex items-center gap-2 font-mono text-[9px] text-miss-white/40"
                  >
                    <div className="flex gap-0.5">
                      {SHIP_SEGMENT_KEYS.slice(0, ship.size).map((segmentKey) => (
                        <div key={segmentKey} className="h-2 w-2 rounded-[1px] bg-radar-green/60" />
                      ))}
                    </div>
                    <span className="flex-1">{ship.size}-пал {ship.isHorizontal ? "↔" : "↕"}</span>
                    <button
                      type="button"
                      onClick={() => removeShip(ship.id)}
                      className="opacity-30 hover:opacity-70 transition-opacity px-1"
                      title="Убрать обратно"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleRandomize}
              className="
                rounded border border-ocean-800 px-4 py-2
                font-mono text-[10px] uppercase tracking-widest
                text-miss-white/50 hover:border-ocean-700 hover:text-miss-white/80
                transition-colors duration-150
              "
            >
              ↻ Случайно
            </button>

            <button
              type="button"
              onClick={clearFleet}
              className="
                rounded border border-ocean-800 px-4 py-2
                font-mono text-[10px] uppercase tracking-widest
                text-miss-white/40 hover:border-hit-red/60 hover:text-hit-red
                transition-colors duration-150
              "
            >
              × Очистить поле
            </button>

            <button
              type="button"
              onClick={handleReady}
              disabled={!allPlaced || isSubmitting || !transport}
              className="
                rounded border px-4 py-3
                font-mono text-sm font-bold uppercase tracking-widest
                transition-colors duration-150
                disabled:cursor-not-allowed
                disabled:border-ocean-800 disabled:text-miss-white/20
                enabled:border-radar-green enabled:text-radar-green
                enabled:hover:bg-radar-green enabled:hover:text-ocean-950
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-green
              "
              style={allPlaced && !isSubmitting ? { boxShadow: "0 0 16px rgba(0,255,136,0.2)" } : {}}
            >
              {isSubmitting
                ? <span style={{ animation: "morse-blink 0.8s step-end infinite" }}>ОТПРАВКА...</span>
                : `[ ГОТОВ — ${placed.length}/${ships.length} ]`
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
