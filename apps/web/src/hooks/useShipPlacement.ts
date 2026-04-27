// apps/web/src/hooks/useShipPlacement.ts
"use client";

// Drag & Drop ship placement via native Pointer Events.
// ВАЖНО: никаких внешних DnD-библиотек — только Pointer Events API.
// `element.setPointerCapture()` гарантирует отслеживание даже за пределами элемента
// (критично для тач-устройств).
//
// Архитектура:
//  • Хук управляет ТОЛЬКО жестом (pointer capture + вычисление координат).
//  • Состояние расстановки живёт в вызывающем компоненте.
//  • При сбросе корабля на валидную клетку вызывается onPlace(shipId, newCoords).
//  • При сбросе за пределы сетки или на невалидную позицию — onPlace не вызывается.

import type { Coordinate } from "@radioboi/game-core";
import { isValidCoordinate, makeCoordinate, parseCoordinate } from "@radioboi/game-core";
import { useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

/** Описание корабля, передаваемого в getShipHandlers. */
export type ShipDefinition = {
  /** Стабильный идентификатор (например, "ship-4-0") */
  id: string;
  /** Текущие координаты корабля на доске ([] если не размещён) */
  coords: Coordinate[];
  /** Размер корабля в клетках */
  size: number;
  /** Ориентация */
  isHorizontal: boolean;
};

/** Результат успешного сброса корабля на доску. */
export type ShipDropResult = {
  shipId: string;
  newCoords: Coordinate[];
};

/** Позиция «призрака» (ghost) в процессе перетаскивания. */
export type DragPosition = {
  clientX: number;
  clientY: number;
};

export type ShipPointerHandlers = {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  /** Отмена по касанию (стандарт Pointer Events) */
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
};

export type UseShipPlacementOptions = {
  /**
   * Вызывается после успешного сброса корабля на валидную позицию.
   * Вызывающий компонент обновляет своё локальное состояние расстановки.
   */
  onPlace: (result: ShipDropResult) => void;
};

export type UseShipPlacementReturn = {
  /** true пока корабль захвачен */
  isDragging: boolean;
  /** Текущая позиция для отрисовки ghost-элемента */
  dragPosition: DragPosition | null;
  /** ID корабля, захваченного в данный момент */
  draggedShipId: string | null;
  /** Возвращает обработчики Pointer Events для конкретного корабля */
  getShipHandlers: (ship: ShipDefinition) => ShipPointerHandlers;
  /**
   * Ref-callback для контейнера доски (own board grid).
   * Используется как fallback при вычислении координат,
   * если у клеток нет data-coord атрибутов.
   */
  setGridElement: (el: HTMLElement | null) => void;
};

// ── Внутренний тип состояния перетаскивания ────────────────────────────────────

type DragState = {
  shipId: string;
  size: number;
  isHorizontal: boolean;
  originalCoords: Coordinate[];
  pointerId: number;
  /** Смещение точки клика относительно верхнего-левого угла элемента (px) */
  offsetX: number;
  offsetY: number;
};

// ── Вычисление координат из точки экрана ──────────────────────────────────────

/**
 * Пытается найти Coordinate в точке (clientX, clientY).
 *
 * Стратегия 1: ищет элемент с атрибутом `data-coord` (предпочтительно).
 * Стратегия 2: fallback — математически вычисляет из размеров первой <td>.
 *
 * Клетки ДОЛЖНЫ иметь `data-coord="АБВ000"` для стратегии 1.
 * Если data-coord отсутствует, стратегия 2 использует позицию первой <td>.
 */
function resolveCoordAtPoint(
  clientX: number,
  clientY: number,
  gridEl: HTMLElement | null,
): Coordinate | null {
  // ── Стратегия 1: data-coord атрибут ─────────────────────────────────────
  const elements = document.elementsFromPoint(clientX, clientY);
  for (const el of elements) {
    const raw = el.getAttribute("data-coord");
    if (raw && isValidCoordinate(raw)) return raw;
  }

  // ── Стратегия 2: вычисление из размеров клетки ───────────────────────────
  if (!gridEl) return null;
  const firstTd = gridEl.querySelector("td");
  if (!firstTd) return null;

  const cellRect = firstTd.getBoundingClientRect();
  const cellW = cellRect.width;
  const cellH = cellRect.height;
  if (cellW <= 0 || cellH <= 0) return null;

  const colIdx = Math.floor((clientX - cellRect.left) / cellW);
  const rowIdx = Math.floor((clientY - cellRect.top) / cellH);
  if (colIdx < 0 || colIdx > 9 || rowIdx < 0 || rowIdx > 9) return null;

  try {
    return makeCoordinate(colIdx, rowIdx);
  } catch {
    return null;
  }
}

/**
 * Строит список координат корабля начиная с опорной клетки.
 * Возвращает null, если корабль выходит за пределы поля.
 */
function buildShipCoords(
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

// ── Хук ───────────────────────────────────────────────────────────────────────

export function useShipPlacement({ onPlace }: UseShipPlacementOptions): UseShipPlacementReturn {
  // ── Состояние UI (триггерит ре-рендер для ghost-элемента) ─────────────────
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState<DragPosition | null>(null);
  const [draggedShipId, setDraggedShipId] = useState<string | null>(null);

  // ── Рефы (не триггерят ре-рендер — нужны для производительности) ─────────
  const dragStateRef = useRef<DragState | null>(null);
  const gridElRef = useRef<HTMLElement | null>(null);
  // Стабильный реф на onPlace чтобы не пересоздавать замыкания
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;

  function setGridElement(el: HTMLElement | null): void {
    gridElRef.current = el;
  }

  // ── Фабрика обработчиков ──────────────────────────────────────────────────

  function getShipHandlers(ship: ShipDefinition): ShipPointerHandlers {
    function onPointerDown(e: React.PointerEvent<HTMLElement>): void {
      // Реагируем только на основную кнопку мыши или тач
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const rect = e.currentTarget.getBoundingClientRect();

      dragStateRef.current = {
        shipId: ship.id,
        size: ship.size,
        isHorizontal: ship.isHorizontal,
        originalCoords: ship.coords,
        pointerId: e.pointerId,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
      };

      // Захват указателя: события продолжают поступать на этот элемент
      // даже если курсор покинул его границы. Идеально для мобильных.
      e.currentTarget.setPointerCapture(e.pointerId);

      setIsDragging(true);
      setDraggedShipId(ship.id);
      setDragPosition({ clientX: e.clientX, clientY: e.clientY });

      // Предотвращает скролл страницы при перетаскивании на тач
      e.preventDefault();
    }

    function onPointerMove(e: React.PointerEvent<HTMLElement>): void {
      const state = dragStateRef.current;
      if (!state || state.shipId !== ship.id) return;

      setDragPosition({ clientX: e.clientX, clientY: e.clientY });
      e.preventDefault();
    }

    function onPointerUp(e: React.PointerEvent<HTMLElement>): void {
      const state = dragStateRef.current;
      if (!state || state.shipId !== ship.id) return;

      // Освобождаем захват указателя перед вычислением позиции
      if (e.currentTarget.hasPointerCapture(state.pointerId)) {
        e.currentTarget.releasePointerCapture(state.pointerId);
      }

      dragStateRef.current = null;
      setIsDragging(false);
      setDragPosition(null);
      setDraggedShipId(null);

      // Смещение: ищем клетку под левым верхним углом корабля
      const anchorClientX = e.clientX - state.offsetX + 4; // +4px — попадаем в центр первой клетки
      const anchorClientY = e.clientY - state.offsetY + 4;

      const anchor = resolveCoordAtPoint(anchorClientX, anchorClientY, gridElRef.current);

      if (!anchor) {
        // Корабль брошен за пределами поля — остаётся в базе (не вызываем onPlace)
        return;
      }

      const newCoords = buildShipCoords(anchor, state.size, state.isHorizontal);
      if (!newCoords) {
        // Корабль выходит за границы поля
        return;
      }

      onPlaceRef.current({ shipId: ship.id, newCoords });
      e.preventDefault();
    }

    function onPointerCancel(e: React.PointerEvent<HTMLElement>): void {
      const state = dragStateRef.current;
      if (!state || state.shipId !== ship.id) return;

      if (e.currentTarget.hasPointerCapture(state.pointerId)) {
        e.currentTarget.releasePointerCapture(state.pointerId);
      }

      dragStateRef.current = null;
      setIsDragging(false);
      setDragPosition(null);
      setDraggedShipId(null);
      // Корабль возвращается в исходное положение — onPlace не вызываем
    }

    return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
  }

  return {
    isDragging,
    dragPosition,
    draggedShipId,
    getShipHandlers,
    setGridElement,
  };
}
