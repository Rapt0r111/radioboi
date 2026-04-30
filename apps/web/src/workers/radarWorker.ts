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

    // ── 1. Полная очистка → прозрачный фон ────────────────────────────────
    // ИСПРАВЛЕНИЕ: предыдущая реализация использовала fillRect с
    // rgba(0,0,0,0.10) каждый кадр. За ~30 кадров (0.5 сек) фон становился
    // непрозрачно-чёрным и полностью скрывал сетку вражеского поля под
    // canvas-оверлеем. Теперь clearRect → канвас прозрачен, сетка видна.
    ctx.clearRect(0, 0, width, height);

    // ── 2. Угол сканирующей линии ─────────────────────────────────────────
    this.#radarAngle = (this.#radarAngle + 0.025) % (Math.PI * 2);

    // ── 3. Послесвечение (веер за лучом) — без чёрного фона ──────────────
    // Рисуем полупрозрачный сегмент-веер сзади луча вместо накопительного
    // fillRect. Визуальный «хвост» сохраняется, фон остаётся прозрачным.
    const fanSpan = 0.55; // радиан (~31°)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, this.#radarAngle - fanSpan, this.#radarAngle);
    ctx.closePath();
    ctx.fillStyle = "rgba(0, 255, 136, 0.07)";
    ctx.fill();
    ctx.restore();

    // ── 4. Сканирующая линия радара ───────────────────────────────────────
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
    ctx.lineTo(cx + Math.cos(this.#radarAngle) * radius, cy + Math.sin(this.#radarAngle) * radius);
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // ── 5. Обводка радара ─────────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 255, 136, 0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // ── 6. Ракеты (красные точки) ─────────────────────────────────────────
    for (const [, missile] of this.#missiles) {
      const px = cx + (missile.x - 0.5) * radius * 2;
      const py = cy + (missile.y - 0.5) * radius * 2;

      ctx.save();
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