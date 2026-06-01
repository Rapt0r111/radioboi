// apps/web/src/components/RadarCanvas.tsx
"use client";
//
// FIX: RadarCanvas теперь измеряет реальное смещение ячеек относительно
// canvas (заголовки строк w-5, заголовки столбцов) и передаёт эти координаты
// в воркер через setGridBounds(). Радар рисуется строго внутри сетки ячеек.

import * as Comlink from "comlink";
import { useEffect, useLayoutEffect, useRef } from "react";

type RadarRendererProxy = {
  init(canvas: OffscreenCanvas): Promise<void>;
  setGridBounds(offsetX: number, offsetY: number, width: number, height: number): Promise<void>;
  updateMissile(id: string, x: number, y: number, progress: number): Promise<void>;
  removeMissile(id: string): Promise<void>;
};

export type RadarRef = RadarRendererProxy | null;

type Props = {
  radarRef?: React.RefObject<RadarRef>;
};

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Измеряет границы области ячеек внутри таблицы-доски.
 * Ищет первый <td> (data-coord) — его левый/верхний край = начало сетки.
 * Последний <td> — его правый/нижний край = конец сетки.
 *
 * @param container — корневой div контейнера (overlays таблицу)
 * @param containerRect — BoundingClientRect контейнера
 */
function measureGridBounds(
  container: HTMLElement,
  containerRect: DOMRect,
): { offsetX: number; offsetY: number; width: number; height: number } | null {
  // Ищем таблицу внутри контейнера или рядом (RadarCanvas — sibling таблицы)
  // Контейнер absolute inset-0, его parent = relative wrapper над таблицей
  const parent = container.parentElement;
  if (!parent) return null;

  const table = parent.querySelector("table");
  if (!table) return null;

  // Первая td с data-coord = первая ячейка (col 0, row 0)
  const firstTd = table.querySelector("td[data-coord]");
  // Последняя td с data-coord = последняя ячейка
  const allTds = table.querySelectorAll("td[data-coord]");
  const lastTd = allTds[allTds.length - 1];

  if (!firstTd || !lastTd) return null;

  const firstRect = firstTd.getBoundingClientRect();
  const lastRect = lastTd.getBoundingClientRect();

  // Переводим в координаты относительно контейнера canvas
  const offsetX = firstRect.left - containerRect.left;
  const offsetY = firstRect.top - containerRect.top;
  const width = lastRect.right - firstRect.left;
  const height = lastRect.bottom - firstRect.top;

  if (width <= 0 || height <= 0) return null;

  return { offsetX, offsetY, width, height };
}

export function RadarCanvas({ radarRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const el: HTMLDivElement = container;

    let canvas: HTMLCanvasElement | null = null;
    let worker: Worker | null = null;
    let proxy: Comlink.Remote<RadarRendererProxy> | null = null;

    async function applyGridBounds(currentProxy: Comlink.Remote<RadarRendererProxy>): Promise<void> {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const bounds = measureGridBounds(el, rect);
      if (bounds) {
        await currentProxy.setGridBounds(bounds.offsetX, bounds.offsetY, bounds.width, bounds.height);
      }
    }

    function setup(width: number, height: number) {
      if (proxy) {
        if (radarRef) radarRef.current = null;
        proxy[Comlink.releaseProxy]();
        proxy = null;
      }
      if (worker) {
        worker.terminate();
        worker = null;
      }
      if (canvas) {
        canvas.remove();
        canvas = null;
      }

      canvas = document.createElement("canvas");
      canvas.className = "absolute inset-0 w-full h-full pointer-events-none";
      canvas.setAttribute("aria-hidden", "true");
      canvas.tabIndex = -1;
      canvas.width = Math.round(width);
      canvas.height = Math.round(height);
      el.appendChild(canvas);

      worker = new Worker(new URL("../workers/radarWorker.ts", import.meta.url), {
        type: "module",
      });
      proxy = Comlink.wrap<RadarRendererProxy>(worker);

      const offscreen = canvas.transferControlToOffscreen();
      void proxy.init(Comlink.transfer(offscreen, [offscreen])).then(() => {
        // После инициализации — передаём bounds ячеек
        if (proxy) void applyGridBounds(proxy);
      });

      if (radarRef) {
        radarRef.current = proxy;
      }
    }

    const rect = el.getBoundingClientRect();
    const initW = rect.width > 0 ? rect.width : el.offsetWidth || 400;
    const initH = rect.height > 0 ? rect.height : el.offsetHeight || 400;
    setup(initW, initH);

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      if (resizeTimeout !== null) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        const currentW = canvas?.width ?? 0;
        const currentH = canvas?.height ?? 0;
        if (Math.abs(currentW - width) > 1 || Math.abs(currentH - height) > 1) {
          setup(width, height);
        } else if (proxy) {
          // Размер не изменился, но bounds могли сдвинуться — пересчитываем
          void applyGridBounds(proxy);
        }
      }, 150);
    });
    observer.observe(el);

    return () => {
      if (resizeTimeout !== null) clearTimeout(resizeTimeout);
      observer.disconnect();
      if (radarRef) radarRef.current = null;
      if (proxy) {
        proxy[Comlink.releaseProxy]();
        proxy = null;
      }
      if (worker) {
        worker.terminate();
        worker = null;
      }
      if (canvas) {
        canvas.remove();
        canvas = null;
      }
    };
  }, [radarRef]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      style={{ overflow: "hidden" }}
      aria-hidden="true"
    />
  );
}