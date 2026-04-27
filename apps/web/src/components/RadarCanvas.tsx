// apps/web/src/components/RadarCanvas.tsx
// React-обёртка для OffscreenCanvas + Comlink-прокси.
// Экспортирует ref на прокси, чтобы вызывать updateMissile без ре-рендера.
//
// ВАЖНО: canvas создаётся императивно внутри effect, а не через JSX.
// Причина: React Strict Mode в dev дважды запускает effects (mount → cleanup →
// mount). После первого transferControlToOffscreen() canvas заблокирован —
// попытка записать width/height при повторном запуске бросает InvalidStateError.
// Создавая свежий <canvas> в каждом запуске и удаляя его в cleanup, мы
// гарантируем, что каждый effect работает с чистым, незахваченным элементом.
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
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function RadarCanvas({ radarRef }: Props) {
  // Ref указывает на контейнер-обёртку, а не на сам canvas.
  // Canvas создаётся/удаляется императивно внутри effect.
  const containerRef = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Создаём чистый canvas при каждом запуске effect.
    //    Это ключевое отличие от ref-подхода: каждый запуск получает
    //    новый элемент без истории вызовов transferControlToOffscreen().
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 w-full h-full pointer-events-none";
    canvas.setAttribute("aria-hidden", "true");
    canvas.tabIndex = -1;
    container.appendChild(canvas);

    // 2. Устанавливаем размер ПЕРЕД передачей контроля воркеру.
    //    После transferControlToOffscreen() менять width/height нельзя.
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width > 0 ? rect.width : container.offsetWidth || 400;
    canvas.height = rect.height > 0 ? rect.height : container.offsetHeight || 400;

    // 3. Создаём воркер и Comlink-прокси.
    const worker = new Worker(new URL("../workers/radarWorker.ts", import.meta.url), {
      type: "module",
    });
    const proxy = Comlink.wrap<RadarRendererProxy>(worker);

    // 4. Передаём OffscreenCanvas в воркер (transferable).
    const offscreen = canvas.transferControlToOffscreen();
    void proxy.init(Comlink.transfer(offscreen, [offscreen]));

    // 5. Пробрасываем прокси наружу.
    if (radarRef) {
      radarRef.current = proxy;
    }

    return () => {
      // Очищаем ref до завершения воркера, чтобы внешний код не вызвал
      // updateMissile/removeMissile на уже уничтоженном прокси.
      if (radarRef) {
        radarRef.current = null;
      }
      proxy[Comlink.releaseProxy]();
      worker.terminate();
      // Удаляем canvas из DOM — следующий запуск effect создаст новый.
      canvas.remove();
    };
  }, [radarRef]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}