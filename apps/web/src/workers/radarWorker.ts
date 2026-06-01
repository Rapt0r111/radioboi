// apps/web/src/workers/radarWorker.ts
// Web Worker: OffscreenCanvas рендеринг радара и ракет.
// Без зависимостей от React или DOM (только WorkerGlobalScope).
//
// FIX: добавлен метод setGridBounds() — воркер теперь рисует радар
// точно внутри области ячеек (без заголовков строк/столбцов).

import { expose } from "comlink";

type MissileEntry = {
  x: number;
  y: number;
  progress: number; // 0.0 → 1.0
};

// Bounds of the actual cell grid within the canvas
type GridBounds = {
  offsetX: number; // pixels from left edge to first cell
  offsetY: number; // pixels from top edge to first cell
  width: number;   // total width of cell area
  height: number;  // total height of cell area
};

class RadarRenderer {
  #canvas: OffscreenCanvas | null = null;
  #ctx: OffscreenCanvasRenderingContext2D | null = null;
  #missiles: Map<string, MissileEntry> = new Map();
  #radarAngle: number = 0;
  #animating: boolean = false;
  #gridBounds: GridBounds = { offsetX: 0, offsetY: 0, width: 0, height: 0 };

  /**
   * Инициализирует рендерер: сохраняет контекст и запускает петлю отрисовки.
   * Контроль над canvas передаётся через `transferControlToOffscreen()`.
   */
  init(canvas: OffscreenCanvas): void {
    this.#canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("RadarRenderer: failed to get 2d context from OffscreenCanvas");
    this.#ctx = ctx;
    // Default grid bounds = full canvas (updated via setGridBounds)
    this.#gridBounds = {
      offsetX: 0,
      offsetY: 0,
      width: canvas.width,
      height: canvas.height,
    };
    this.#animating = true;
    this.#loop();
  }

  /**
   * Устанавливает границы сетки ячеек внутри canvas.
   * Вызывается из RadarCanvas после измерения реального смещения заголовков.
   */
  setGridBounds(offsetX: number, offsetY: number, width: number, height: number): void {
    this.#gridBounds = { offsetX, offsetY, width, height };
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
    requestAnimationFrame(() => this.#loop());
  }

  #draw(): void {
    const ctx = this.#ctx;
    const canvas = this.#canvas;
    if (!ctx || !canvas) return;

    const { width: cw, height: ch } = canvas;

    // ── 1. Полная очистка → прозрачный фон ────────────────────────────────
    ctx.clearRect(0, 0, cw, ch);

    // ── Grid bounds: используем только область ячеек ─────────────────────
    const { offsetX, offsetY, width: gw, height: gh } = this.#gridBounds;

    // Центр и радиус — строго внутри сетки ячеек
    const cx = offsetX + gw / 2;
    const cy = offsetY + gh / 2;
    // Радиус = половина меньшей стороны минус 2px чтобы не касаться границ
    const radius = Math.min(gw, gh) / 2 - 2;

    // ── 2. Clip: рисуем только внутри области ячеек ───────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.rect(offsetX, offsetY, gw, gh);
    ctx.clip();

    // ── 3. Угол сканирующей линии ─────────────────────────────────────────
    this.#radarAngle = (this.#radarAngle + 0.025) % (Math.PI * 2);

    // ── 4. Послесвечение (веер за лучом) ──────────────────────────────────
    const fanSpan = 0.55;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, this.#radarAngle - fanSpan, this.#radarAngle);
    ctx.closePath();
    ctx.fillStyle = "rgba(0, 255, 136, 0.07)";
    ctx.fill();

    // ── 5. Сканирующая линия радара ───────────────────────────────────────
    const lineGrad = ctx.createLinearGradient(
      cx,
      cy,
      cx + Math.cos(this.#radarAngle) * radius,
      cy + Math.sin(this.#radarAngle) * radius,
    );
    lineGrad.addColorStop(0, "rgba(0, 255, 136, 0.9)");
    lineGrad.addColorStop(1, "rgba(0, 255, 136, 0.0)");

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(this.#radarAngle) * radius, cy + Math.sin(this.#radarAngle) * radius);
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 2;
    ctx.stroke();

    // ── 6. Обводка радара (круг строго по ячейкам) ────────────────────────
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 255, 136, 0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── 7. Ракеты (красные точки) ─────────────────────────────────────────
    for (const [, missile] of this.#missiles) {
      // missile.x / missile.y — нормализованные [0,1] координаты внутри сетки
      const px = offsetX + missile.x * gw;
      const py = offsetY + missile.y * gh;

      ctx.save();
      ctx.shadowColor = "#ff3b3b";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#ff3b3b";
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Снимаем clip
    ctx.restore();
  }
}

// Экспортируем единственный инстанс через Comlink.
expose(new RadarRenderer());