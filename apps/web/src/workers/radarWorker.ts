// apps/web/src/workers/radarWorker.ts
// Web Worker: OffscreenCanvas рендеринг радара и ракет.
// Без зависимостей от React или DOM (только WorkerGlobalScope).

import { expose } from "comlink";

type MissileEntry = {
  x: number;
  y: number;
  progress: number; // 0.0 → 1.0
};

class RadarRenderer {
  #canvas: OffscreenCanvas | null = null;
  #ctx: OffscreenCanvasRenderingContext2D | null = null;
  #missiles: Map<string, MissileEntry> = new Map();
  #radarAngle: number = 0;
  #animating: boolean = false;

  /**
   * Инициализирует рендерер: сохраняет контекст и запускает петлю отрисовки.
   * Контроль над canvas передаётся через `transferControlToOffscreen()`.
   */
  init(canvas: OffscreenCanvas): void {
    this.#canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("RadarRenderer: failed to get 2d context from OffscreenCanvas");
    this.#ctx = ctx;
    this.#animating = true;
    this.#loop();
  }

  /** Обновляет или добавляет ракету по id. */
  updateMissile(id: string, x: number, y: number, progress: number): void {
    this.#missiles.set(id, { x, y, progress });
  }

  /** Удаляет ракету по id. */
  removeMissile(id: string): void {
    this.#missiles.delete(id);
  }

  // ── Приватные методы ───────────────────────────────────────────────────────

  #loop(): void {
    if (!this.#animating) return;
    this.#draw();
    // requestAnimationFrame доступен в DedicatedWorkerGlobalScope.
    requestAnimationFrame(() => this.#loop());
  }

  #draw(): void {
    const ctx = this.#ctx;
    const canvas = this.#canvas;
    if (!ctx || !canvas) return;

    const { width, height } = canvas;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(cx, cy) - 4;

    // ── 1. Затухающий след (persistence effect) ───────────────────────────
    // Полупрозрачный чёрный поверх предыдущего кадра создаёт «хвост» радара.
    ctx.fillStyle = "rgba(0, 0, 0, 0.10)";
    ctx.fillRect(0, 0, width, height);

    // ── 2. Сканирующая линия радара ───────────────────────────────────────
    this.#radarAngle = (this.#radarAngle + 0.025) % (Math.PI * 2);

    // Градиент: яркий у центра, затухает к концу луча
    const lineGrad = ctx.createLinearGradient(
      cx,
      cy,
      cx + Math.cos(this.#radarAngle) * radius,
      cy + Math.sin(this.#radarAngle) * radius,
    );
    lineGrad.addColorStop(0, "rgba(0, 255, 136, 0.9)");
    lineGrad.addColorStop(1, "rgba(0, 255, 136, 0.0)");

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(this.#radarAngle) * radius,
      cy + Math.sin(this.#radarAngle) * radius,
    );
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // ── 3. Обводка радара ─────────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 255, 136, 0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // ── 4. Ракеты (красные точки) ─────────────────────────────────────────
    for (const [, missile] of this.#missiles) {
      const px = cx + (missile.x - 0.5) * radius * 2;
      const py = cy + (missile.y - 0.5) * radius * 2;

      ctx.save();
      // Внешнее свечение
      ctx.shadowColor = "#ff3b3b";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#ff3b3b";
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

// Экспортируем единственный инстанс через Comlink.
expose(new RadarRenderer());