// apps/web/src/components/ShipPlacementScreen.tsx
"use client";

import {
  COLUMNS,
  type Coordinate,
  GameEventType,
  makeCoordinate,
  parseCoordinate,
  REQUIRED_FLEET,
  ROWS,
  validatePlacement,
} from "@radioboi/game-core";
import { useMemo, useState } from "react";
import type { GameClient } from "@/src/lib/network/gameClient";

// ── Types ─────────────────────────────────────────────────────────────────────

type ShipEntry = {
  id: string;
  size: number;
  coords: Coordinate[];
  isHorizontal: boolean;
};

type Props = {
  transport: GameClient | null;
  playerId: string | null;
  roomId: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Строит координаты корабля начиная от якорной клетки. null = выходит за поле. */
function buildCoords(
  anchor: Coordinate,
  size: number,
  isHorizontal: boolean,
): Coordinate[] | null {
  const { colIndex, rowIndex } = parseCoordinate(anchor);
  const coords: Coordinate[] = [];
  for (let i = 0; i < size; i++) {
    const c = isHorizontal ? colIndex + i : colIndex;
    const r = isHorizontal ? rowIndex : rowIndex + i;
    if (c > 9 || r > 9) return null;
    try {
      coords.push(makeCoordinate(c, r));
    } catch {
      return null;
    }
  }
  return coords;
}

/** Начальный состав флота из REQUIRED_FLEET, отсортированный по убыванию. */
function buildFleet(): ShipEntry[] {
  const ships: ShipEntry[] = [];
  const entries = [...REQUIRED_FLEET.entries()].sort((a, b) => b[0] - a[0]);
  for (const [size, count] of entries) {
    for (let i = 0; i < count; i++) {
      ships.push({ id: `ship-${size}-${i}`, size, coords: [], isHorizontal: true });
    }
  }
  return ships;
}

/** Быстрое автоматическое размещение кораблей случайным образом. */
function autoPlace(ships: ShipEntry[]): ShipEntry[] {
  const result: ShipEntry[] = ships.map((s) => ({ ...s, coords: [] }));
  const occupied = new Set<string>();

  const addNeighbors = (coords: Coordinate[]): void => {
    for (const c of coords) {
      const { colIndex: ci, rowIndex: ri } = parseCoordinate(c);
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const nc = ci + dc;
          const nr = ri + dr;
          if (nc >= 0 && nc <= 9 && nr >= 0 && nr <= 9) {
            try {
              occupied.add(makeCoordinate(nc, nr));
            } catch {
              /* skip */
            }
          }
        }
      }
    }
  };

  // Крупные корабли сначала
  const sorted = [...result.keys()].sort((a, b) => (result[b]?.size ?? 0) - (result[a]?.size ?? 0));

  for (const idx of sorted) {
    const ship = result[idx];
    if (!ship) continue;

    let placed = false;
    let attempts = 0;

    while (!placed && attempts < 2000) {
      attempts++;
      const isH = Math.random() > 0.5;
      const maxCol = isH ? 10 - ship.size : 9;
      const maxRow = isH ? 9 : 10 - ship.size;
      const col = Math.floor(Math.random() * (maxCol + 1));
      const row = Math.floor(Math.random() * (maxRow + 1));

      try {
        const anchor = makeCoordinate(col, row);
        const coords = buildCoords(anchor, ship.size, isH);
        if (!coords) continue;

        const hasConflict = coords.some((c) => occupied.has(c));
        if (hasConflict) continue;

        result[idx] = { ...ship, coords, isHorizontal: isH };
        for (const c of coords) occupied.add(c);
        addNeighbors(coords);
        placed = true;
      } catch {
        /* retry */
      }
    }
  }

  return result;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ShipPlacementScreen({ transport, playerId: _playerId, roomId }: Props) {
  const [ships, setShips] = useState<ShipEntry[]>(buildFleet);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isHorizontal, setIsHorizontal] = useState(true);
  const [hoveredCoord, setHoveredCoord] = useState<Coordinate | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const selectedShip = ships.find((s) => s.id === selectedId) ?? null;

  // Множество занятых координат
  const occupiedCoords = useMemo(() => {
    const set = new Set<Coordinate>();
    for (const s of ships) {
      for (const c of s.coords) set.add(c);
    }
    return set;
  }, [ships]);

  // Map coord → shipId (для кликов по размещённым кораблям)
  const coordToShipId = useMemo(() => {
    const map = new Map<Coordinate, string>();
    for (const s of ships) {
      for (const c of s.coords) map.set(c, s.id);
    }
    return map;
  }, [ships]);

  // Координаты предварительного просмотра при наведении
  const previewCoords = useMemo((): Coordinate[] => {
    if (!selectedShip || !hoveredCoord) return [];
    return buildCoords(hoveredCoord, selectedShip.size, isHorizontal) ?? [];
  }, [selectedShip, hoveredCoord, isHorizontal]);

  // Проверяем, не перекрывается ли превью с ДРУГИМИ кораблями
  const isPreviewValid = useMemo(() => {
    if (previewCoords.length === 0) return false;
    const ownCoords = new Set(selectedShip?.coords ?? []);
    for (const c of previewCoords) {
      if (occupiedCoords.has(c) && !ownCoords.has(c)) return false;
    }
    return true;
  }, [previewCoords, occupiedCoords, selectedShip]);

  const placedCount = ships.filter((s) => s.coords.length > 0).length;
  const allPlaced = placedCount === ships.length;

  const validationResult = useMemo(() => {
    if (!allPlaced) return null;
    return validatePlacement(
      ships.filter((s) => s.coords.length > 0).map((s) => ({ coords: s.coords as readonly Coordinate[] })),
    );
  }, [allPlaced, ships]);

  const canSubmit = allPlaced && validationResult?.ok === true && !isSubmitted && transport !== null;

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleCellClick(coord: Coordinate): void {
    if (isSubmitted) return;

    if (selectedShip) {
      // Размещаем выбранный корабль
      const newCoords = buildCoords(coord, selectedShip.size, isHorizontal);
      if (!newCoords) return;

      // Проверяем перекрытие с другими кораблями (не с самим собой)
      const ownSet = new Set(selectedShip.coords);
      for (const c of newCoords) {
        if (occupiedCoords.has(c) && !ownSet.has(c)) return;
      }

      setShips((prev) =>
        prev.map((s) => (s.id === selectedId ? { ...s, coords: newCoords, isHorizontal } : s)),
      );
      setSelectedId(null);
      setHoveredCoord(null);
      return;
    }

    // Кликаем на размещённый корабль → поднимаем его
    const shipIdAtCoord = coordToShipId.get(coord);
    if (shipIdAtCoord) {
      const pickedShip = ships.find((s) => s.id === shipIdAtCoord);
      if (pickedShip) setIsHorizontal(pickedShip.isHorizontal);
      setShips((prev) => prev.map((s) => (s.id === shipIdAtCoord ? { ...s, coords: [] } : s)));
      setSelectedId(shipIdAtCoord);
    }
  }

  function handleSelectDockShip(shipId: string): void {
    if (isSubmitted) return;
    setSelectedId((prev) => (prev === shipId ? null : shipId));
  }

  function handleAutoPlace(): void {
    if (isSubmitted) return;
    setShips(autoPlace(ships));
    setSelectedId(null);
    setHoveredCoord(null);
  }

  function handleClearAll(): void {
    if (isSubmitted) return;
    setShips((prev) => prev.map((s) => ({ ...s, coords: [] })));
    setSelectedId(null);
  }

  function handleSubmit(): void {
    if (!canSubmit) return;
    setIsSubmitted(true);
    const payload = ships
      .filter((s) => s.coords.length > 0)
      .map((s) => ({ coords: s.coords as readonly Coordinate[] }));
    transport?.send({ type: GameEventType.SHIPS_PLACED, payload: { ships: payload } });
  }

  // ── Cell state ─────────────────────────────────────────────────────────────

  type CellKind = "empty" | "ship" | "preview-ok" | "preview-bad" | "cursor";

  function getCellKind(coord: Coordinate): CellKind {
    const isPreview = previewCoords.includes(coord);
    if (isPreview) return isPreviewValid ? "preview-ok" : "preview-bad";
    const shipId = coordToShipId.get(coord);
    if (shipId) return selectedId && shipId === selectedId ? "cursor" : "ship";
    return "empty";
  }

  const cellClass: Record<CellKind, string> = {
    empty:
      "border-[var(--color-ocean-800)] bg-[var(--color-ocean-900)] hover:bg-[var(--color-ocean-800)]",
    ship: "border-[var(--color-radar-dim)] bg-[var(--color-ocean-800)] cursor-pointer hover:border-[var(--color-hit-red)]/60 hover:bg-[var(--color-hit-red)]/10",
    "preview-ok": "border-[var(--color-radar-green)]/70 bg-[var(--color-radar-green)]/15",
    "preview-bad": "border-[var(--color-hit-red)]/60 bg-[var(--color-hit-red)]/15",
    cursor: "border-[var(--color-radar-green)] bg-[var(--color-radar-green)]/20",
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--color-ocean-950)] text-[var(--color-miss-white)] crt-scanlines">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-[var(--color-ocean-800)] bg-[var(--color-ocean-900)]/80 px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.34em] text-[var(--color-radar-green)]/50">
              Морской радиобой · {roomId}
            </p>
            <h1 className="morse-glow font-mono text-xl font-bold tracking-[0.28em] text-[var(--color-radar-green)]">
              РАССТАНОВКА КОРАБЛЕЙ
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isSubmitted}
              className="rounded border border-[var(--color-ocean-800)] px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-miss-white)]/50 transition-colors hover:border-[var(--color-hit-red)]/50 hover:text-[var(--color-hit-red)] disabled:opacity-30"
            >
              ОЧИСТИТЬ
            </button>
            <button
              type="button"
              onClick={handleAutoPlace}
              disabled={isSubmitted}
              className="rounded border border-[var(--color-ocean-800)] px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-miss-white)]/60 transition-colors hover:border-[var(--color-radar-green)]/40 hover:text-[var(--color-radar-green)] disabled:opacity-30"
            >
              АВТО
            </button>
            <button
              type="button"
              onClick={() => {
                setIsHorizontal((h) => !h);
              }}
              disabled={isSubmitted}
              className="rounded border border-[var(--color-morse-amber)]/60 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-morse-amber)] transition-colors hover:bg-[var(--color-morse-amber)]/10 disabled:opacity-30"
            >
              {isHorizontal ? "◀▶ ГОРИЗОНТ" : "▲▼ ВЕРТИКАЛЬ"}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="radar-glow rounded border px-6 py-2 font-mono text-[10px] font-bold uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:border-[var(--color-ocean-800)] disabled:text-[var(--color-miss-white)]/20 enabled:border-[var(--color-radar-green)] enabled:text-[var(--color-radar-green)] enabled:hover:bg-[var(--color-radar-green)] enabled:hover:text-[var(--color-ocean-950)]"
            >
              {isSubmitted ? "ОЖИДАНИЕ..." : "ГОТОВ"}
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-wrap gap-8 px-6 py-8">
        {/* Fleet dock */}
        <aside className="flex w-44 flex-col gap-2" aria-label="Список кораблей">
          <p className="font-mono text-[9px] uppercase tracking-widest text-[var(--color-radar-green)]/50">
            Флот
          </p>

          {ships.map((ship) => {
            const isPlaced = ship.coords.length > 0;
            const isSelected = ship.id === selectedId;
            return (
              <button
                key={ship.id}
                type="button"
                disabled={isSubmitted || isPlaced}
                onClick={() => handleSelectDockShip(ship.id)}
                aria-pressed={isSelected}
                className={[
                  "flex items-center gap-2 rounded border px-3 py-2 font-mono text-[10px] transition-colors",
                  isPlaced
                    ? "cursor-default border-[var(--color-ocean-800)] opacity-35"
                    : isSelected
                      ? "border-[var(--color-radar-green)] bg-[var(--color-radar-green)]/10 text-[var(--color-radar-green)]"
                      : "cursor-pointer border-[var(--color-ocean-800)] text-[var(--color-miss-white)]/60 hover:border-[var(--color-radar-green)]/40",
                ].join(" ")}
              >
                <span className="flex gap-0.5" aria-hidden="true">
                  {Array.from({ length: ship.size }).map((_, i) => (
                    <span
                      key={i}
                      className={`h-3 w-3 rounded-[2px] ${
                        isPlaced
                          ? "bg-[var(--color-ocean-800)]"
                          : isSelected
                            ? "bg-[var(--color-radar-green)]"
                            : "bg-[var(--color-miss-white)]/40"
                      }`}
                    />
                  ))}
                </span>
                <span>{ship.size}-кл.</span>
              </button>
            );
          })}

          {/* Статус */}
          <div className="mt-4 border-t border-[var(--color-ocean-800)] pt-4 space-y-1">
            <p className="font-mono text-[8px] uppercase tracking-widest text-[var(--color-miss-white)]/30">
              {placedCount}/{ships.length} размещено
            </p>
            {allPlaced && validationResult && !validationResult.ok && (
              <p className="font-mono text-[8px] uppercase tracking-widest text-[var(--color-hit-red)]">
                ✕ КОНФЛИКТ
              </p>
            )}
            {allPlaced && validationResult?.ok && !isSubmitted && (
              <p className="font-mono text-[8px] uppercase tracking-widest text-[var(--color-radar-green)]">
                ✓ ГОТОВО К БОЮ
              </p>
            )}
            {isSubmitted && (
              <p
                className="font-mono text-[8px] uppercase tracking-widest text-[var(--color-morse-amber)]"
                style={{ animation: "morse-blink 1s step-end infinite" }}
              >
                ОЖИДАНИЕ...
              </p>
            )}
          </div>
        </aside>

        {/* Placement grid */}
        <section aria-label="Поле расстановки">
          <p className="mb-3 font-mono text-[9px] text-[var(--color-miss-white)]/40 uppercase tracking-widest">
            {selectedShip
              ? `Выбран ${selectedShip.size}-клеточный · кликните клетку для установки`
              : isSubmitted
                ? "Ожидаем противника..."
                : "Выберите корабль в доке"}
          </p>

          <table
            className="border-separate border-spacing-0.5"
            aria-label="Сетка расстановки"
            onMouseLeave={() => setHoveredCoord(null)}
          >
            <thead>
              <tr>
                <th className="w-5" />
                {COLUMNS.map((col) => (
                  <th
                    key={col}
                    scope="col"
                    className="text-center text-[9px] font-mono text-[var(--color-radar-dim)] leading-tight"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, rowIndex) => (
                <tr key={row}>
                  <th
                    scope="row"
                    className="w-5 text-center text-[9px] font-mono text-[var(--color-radar-dim)]"
                  >
                    {rowIndex}
                  </th>
                  {COLUMNS.map((col) => {
                    const coord = (col + row) as Coordinate;
                    const kind = getCellKind(coord);
                    return (
                      <td key={coord} className="p-0">
                        <button
                          type="button"
                          data-coord={coord}
                          aria-label={`${col}${rowIndex}`}
                          disabled={isSubmitted}
                          onClick={() => handleCellClick(coord)}
                          onMouseEnter={() => {
                            if (!isSubmitted) setHoveredCoord(coord);
                          }}
                          className={[
                            "relative flex h-7 w-7 items-center justify-center border text-[10px] font-mono transition-colors duration-75 select-none",
                            cellClass[kind],
                          ].join(" ")}
                        >
                          {kind === "ship" || kind === "cursor" ? "▪" : ""}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Instructions */}
        <aside className="hidden w-40 flex-col gap-3 xl:flex" aria-label="Инструкция">
          <p className="font-mono text-[9px] uppercase tracking-widest text-[var(--color-radar-green)]/50">
            Инструкция
          </p>
          <div className="space-y-2 font-mono text-[9px] leading-relaxed text-[var(--color-miss-white)]/40">
            <p>① Выберите корабль в доке</p>
            <p>② Кликните клетку для размещения</p>
            <p>③ Кликните размещённый корабль чтобы убрать</p>
            <p>④ ◀▶/▲▼ — ориентация</p>
            <p>⑤ АВТО — случайная расстановка</p>
            <p>⑥ Нажмите ГОТОВ</p>
          </div>

          <div className="mt-2 rounded border border-[var(--color-ocean-800)] p-3">
            <p className="mb-1 font-mono text-[8px] uppercase tracking-widest text-[var(--color-radar-green)]/40">
              Состав флота:
            </p>
            {[...REQUIRED_FLEET.entries()]
              .sort((a, b) => b[0] - a[0])
              .map(([size, count]) => (
                <p key={size} className="font-mono text-[9px] text-[var(--color-miss-white)]/40">
                  {count}× {size}-клеточный
                </p>
              ))}
          </div>

          <div className="rounded border border-[var(--color-ocean-800)] p-3 font-mono text-[8px] leading-relaxed text-[var(--color-miss-white)]/30">
            Корабли не должны соприкасаться (включая диагонали)
          </div>
        </aside>
      </main>
    </div>
  );
}