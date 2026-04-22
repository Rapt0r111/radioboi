// apps/web/src/components/RadarCanvas.tsx
// React-обёртка для OffscreenCanvas + Comlink-прокси.
// Экспортирует ref на прокси, чтобы вызывать updateMissile без ре-рендера.
"use client";

import * as Comlink from "comlink";
import { useEffect, useLayoutEffect, useRef } from "react";

// ── Тип воркера (совпадает с экспортируемым классом) ──────────────────────────

type RadarRendererProxy = {
  init(canvas: OffscreenCanvas): Promise<void>;
  updateMissile(id: string, x: number, y: number, progress: number): Promise<void>;
  removeMissile(id: string): Promise<void>;
};

// ── Ref-тип, экспортируемый наружу ───────────────────────────────────────────

export type RadarRef = RadarRendererProxy | null;

type Props = {
  radarRef?: React.RefObject<RadarRef>;
};

// Используем useLayoutEffect в браузере, useEffect на сервере (SSR guard).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function RadarCanvas({ radarRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useIsomorphicLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 1. Создаём воркер через Vite/Webpack-совместимый URL-синтаксис.
    const worker = new Worker(
      new URL("../workers/radarWorker.ts", import.meta.url),
      { type: "module" },
    );

    // 2. Оборачиваем в Comlink-прокси.
    const proxy = Comlink.wrap<RadarRendererProxy>(worker);

    // 3. Передаём контроль над canvas в воркер (transferable).
    const offscreen = canvas.transferControlToOffscreen();
    void proxy.init(Comlink.transfer(offscreen, [offscreen]));

    // 4. Пробрасываем прокси в ref для внешних вызовов.
    if (radarRef) {
      // но это намеренная инициализация при маунте.
      radarRef.current = proxy;
    }

    return () => {
      if (radarRef) {
        radarRef.current = null;
      }
      proxy[Comlink.releaseProxy]();
      worker.terminate();
    };
  }, [radarRef]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      // Размеры задаются родителем через CSS; canvas масштабируется автоматически.
      aria-hidden="true"
    />
  );
}