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


type EffectKind = "hit" | "miss" | "sunk" | "intercept" | "fire" | "bubble" | "rocket";

type EffectEntry = {
  kind: EffectKind;
  x: number;
  y: number;
  startedAt: number;
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
  #effects: EffectEntry[] = [];
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

  triggerEffect(kind: EffectKind, x: number, y: number): void {
    this.#effects.push({ kind, x, y, startedAt: performance.now() });
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
      // missile.x / missile.y are normalized [0,1] coordinates inside the grid
      const px = offsetX + missile.x * gw;
      const py = offsetY + missile.y * gh;
      const trail = Math.max(0, Math.min(1, missile.progress));

      const angle = Math.atan2(py - cy, px - cx);
      const tailX = cx + (px - cx) * Math.max(0, trail - 0.18);
      const tailY = cy + (py - cy) * Math.max(0, trail - 0.18);

      ctx.save();
      ctx.shadowColor = "#ff3b3b";
      ctx.shadowBlur = 10;
      ctx.strokeStyle = "rgba(255, 92, 0, 0.55)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(px - Math.cos(angle) * 6, py - Math.sin(angle) * 6);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 210, 64, 0.65)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(px, py);
      ctx.stroke();

      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.fillStyle = "#ff3b3b";
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-5, -4);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-5, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255, 240, 180, 0.95)";
      ctx.fillRect(-2, -1, 4, 2);
      ctx.restore();
    }

    const now = performance.now();
    this.#effects = this.#effects.filter((effect) => {
      const age = now - effect.startedAt;
      const duration = effect.kind === "sunk" ? 1_200 : 850;
      if (age > duration) return false;

      const px = offsetX + effect.x * gw;
      const py = offsetY + effect.y * gh;
      const t = age / duration;
      const alpha = 1 - t;
      const palette: Record<EffectKind, string> = {
        bubble: "120, 220, 255",
        fire: "255, 92, 0",
        hit: "255, 210, 64",
        intercept: "80, 180, 255",
        miss: "180, 180, 180",
        rocket: "255, 80, 40",
        sunk: "255, 64, 64",
      };
      const color = palette[effect.kind];
      const radiusBoost = effect.kind === "sunk" ? 30 : effect.kind === "miss" ? 18 : effect.kind === "fire" ? 24 : 22;

      ctx.save();
      ctx.shadowColor = `rgba(${color}, ${alpha})`;
      ctx.shadowBlur = 18 * alpha;
      ctx.strokeStyle = `rgba(${color}, ${alpha})`;
      ctx.fillStyle = `rgba(${color}, ${0.18 * alpha})`;
      ctx.lineWidth = effect.kind === "miss" ? 1.5 : 2.5;
      ctx.beginPath();
      ctx.arc(px, py, 4 + radiusBoost * t, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (effect.kind === "hit" || effect.kind === "sunk") {
        for (let i = 0; i < 10; i++) {
          const angle = (Math.PI * 2 * i) / 10 + t * 1.4;
          const dotRadius = 9 + 18 * t + (i % 2) * 4;
          ctx.beginPath();
          ctx.arc(px + Math.cos(angle) * dotRadius, py + Math.sin(angle) * dotRadius, 1.4 + (i % 3), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (effect.kind === "fire") {
        for (let i = 0; i < 7; i++) {
          const angle = -Math.PI / 2 + (i - 3) * 0.22;
          const flame = 8 + 24 * t + i;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(angle) * flame, py + Math.sin(angle) * flame);
          ctx.stroke();
        }
      }

      if (effect.kind === "bubble") {
        ctx.strokeStyle = `rgba(${color}, ${0.65 * alpha})`;
        ctx.fillStyle = "transparent";
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI * 2 * i) / 6;
          const bubbleX = px + Math.cos(angle) * (8 + 16 * t);
          const bubbleY = py - 18 * t + Math.sin(angle) * (5 + 12 * t);
          ctx.beginPath();
          ctx.arc(bubbleX, bubbleY, 2 + 5 * t, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (effect.kind === "intercept") {
        ctx.beginPath();
        ctx.moveTo(px - 10, py - 10);
        ctx.lineTo(px + 10, py + 10);
        ctx.moveTo(px + 10, py - 10);
        ctx.lineTo(px - 10, py + 10);
        ctx.stroke();
      }

      if (effect.kind === "sunk") {
        ctx.beginPath();
        ctx.moveTo(px - 14, py);
        ctx.lineTo(px + 14, py);
        ctx.moveTo(px, py - 14);
        ctx.lineTo(px, py + 14);
        ctx.stroke();
      }

      ctx.restore();
      return true;
    });

    // Remove clip
    ctx.restore();
  }
}

// Экспортируем единственный инстанс через Comlink.
expose(new RadarRenderer());