// apps/web/src/components/RadarCanvas.tsx
"use client";

import * as Comlink from "comlink";
import { useEffect, useLayoutEffect, useRef } from "react";

type RadarRendererProxy = {
  init(canvas: OffscreenCanvas): Promise<void>;
  updateMissile(id: string, x: number, y: number, progress: number): Promise<void>;
  removeMissile(id: string): Promise<void>;
};

export type RadarRef = RadarRendererProxy | null;

type Props = {
  radarRef?: React.RefObject<RadarRef>;
};

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function RadarCanvas({ radarRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const el: HTMLDivElement = container;

    let canvas: HTMLCanvasElement | null = null;
    let worker: Worker | null = null;
    let proxy: Comlink.Remote<RadarRendererProxy> | null = null;

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
      void proxy.init(Comlink.transfer(offscreen, [offscreen]));

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
      // overflow-hidden обрезает всё что выходит за границы — включая shadowBlur воркера
      style={{ overflow: "hidden" }}
      aria-hidden="true"
    />
  );
}