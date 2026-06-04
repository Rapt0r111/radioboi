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
  startedAt: number;
};


type EffectKind = "hit" | "miss" | "sunk" | "intercept" | "fire" | "bubble" | "rocket";

type EffectEntry = {
  kind: EffectKind;
  x: number;
  y: number;
  startedAt: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  const t = clamp01(value);
  return 1 - (1 - t) ** 3;
}

function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43_758.5453;
  return x - Math.floor(x);
}

function seededRange(seed: number, min: number, max: number): number {
  return min + seededUnit(seed) * (max - min);
}

function effectDuration(kind: EffectKind): number {
  switch (kind) {
    case "sunk":
      return 2_050;
    case "fire":
      return 1_900;
    case "bubble":
      return 1_750;
    case "miss":
      return 1_550;
    case "hit":
      return 1_050;
    case "rocket":
      return 720;
    case "intercept":
      return 900;
  }
}

function colorForEffect(kind: EffectKind): string {
  switch (kind) {
    case "bubble":
      return "120, 220, 255";
    case "fire":
      return "255, 92, 0";
    case "hit":
      return "255, 210, 64";
    case "intercept":
      return "80, 180, 255";
    case "miss":
      return "180, 230, 255";
    case "rocket":
      return "255, 80, 40";
    case "sunk":
      return "255, 64, 64";
  }
}

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
    const existing = this.#missiles.get(id);
    this.#missiles.set(id, {
      x,
      y,
      progress,
      startedAt: existing?.startedAt ?? performance.now(),
    });
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
      const targetX = offsetX + missile.x * gw;
      const targetY = offsetY + missile.y * gh;
      const travel = Math.max(
        clamp01(missile.progress),
        clamp01((performance.now() - missile.startedAt) / 900),
      );
      const launch = easeOutCubic(travel);
      const px = cx + (targetX - cx) * launch;
      const py = cy + (targetY - cy) * launch;
      const angle = Math.atan2(targetY - cy, targetX - cx);
      const tailProgress = Math.max(0, launch - 0.24);
      const tailX = cx + (targetX - cx) * tailProgress;
      const tailY = cy + (targetY - cy) * tailProgress;
      const pulse = 0.72 + Math.sin(performance.now() / 72) * 0.28;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = "#ff5c00";
      ctx.shadowBlur = 18 + 12 * pulse;

      const plume = ctx.createLinearGradient(tailX, tailY, px, py);
      plume.addColorStop(0, "rgba(255, 38, 10, 0)");
      plume.addColorStop(0.24, "rgba(255, 80, 12, 0.34)");
      plume.addColorStop(0.62, "rgba(255, 184, 36, 0.74)");
      plume.addColorStop(1, "rgba(255, 255, 210, 0.95)");
      ctx.strokeStyle = plume;
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.quadraticCurveTo(
        (tailX + px) / 2 + Math.sin(performance.now() / 95) * 4,
        (tailY + py) / 2 - Math.cos(performance.now() / 120) * 4,
        px - Math.cos(angle) * 8,
        py - Math.sin(angle) * 8,
      );
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 245, 160, 0.9)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(px, py);
      ctx.stroke();

      for (let i = 0; i < 9; i++) {
        const sparkT = seededRange(i + missile.startedAt, 0.05, 0.95);
        const sparkX = tailX + (px - tailX) * sparkT + seededRange(i * 11 + missile.startedAt, -5, 5);
        const sparkY = tailY + (py - tailY) * sparkT + seededRange(i * 17 + missile.startedAt, -5, 5);
        const sparkAlpha = seededRange(i * 23 + missile.startedAt, 0.35, 0.95) * (1 - sparkT * 0.55);
        ctx.fillStyle = `rgba(255, ${Math.round(seededRange(i * 31 + missile.startedAt, 130, 245))}, 56, ${sparkAlpha})`;
        ctx.beginPath();
        ctx.arc(sparkX, sparkY, seededRange(i * 37 + missile.startedAt, 1.1, 2.8), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = `rgba(255, 210, 64, ${0.38 * (1 - travel)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(targetX, targetY, 8 + 20 * launch, 0, Math.PI * 2);
      ctx.stroke();

      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.shadowColor = "#fff0a8";
      ctx.shadowBlur = 22;
      const body = ctx.createLinearGradient(-7, -5, 10, 5);
      body.addColorStop(0, "#7a0b08");
      body.addColorStop(0.35, "#ff3b3b");
      body.addColorStop(0.72, "#ffb22e");
      body.addColorStop(1, "#fff4b8");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(-7, -5);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-7, 5);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "rgba(255, 245, 190, 0.98)";
      ctx.fillRect(-2, -1.2, 5, 2.4);
      ctx.fillStyle = `rgba(255, 104, 20, ${0.78 + 0.22 * pulse})`;
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(-15 - 4 * pulse, -3.5);
      ctx.lineTo(-12 - 7 * pulse, 0);
      ctx.lineTo(-15 - 4 * pulse, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    const now = performance.now();
    this.#effects = this.#effects.filter((effect) => {
      const age = now - effect.startedAt;
      const duration = effectDuration(effect.kind);
      if (age > duration) return false;

      const px = offsetX + effect.x * gw;
      const py = offsetY + effect.y * gh;
      const t = age / duration;
      const eased = easeOutCubic(t);
      const alpha = 1 - t;
      const color = colorForEffect(effect.kind);
      const cellSize = Math.max(12, Math.min(gw, gh) / 10);
      const baseRadius = cellSize * 0.28;
      const seedBase = Math.floor(effect.x * 10_000 + effect.y * 20_000 + effect.startedAt % 997);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = `rgba(${color}, ${alpha})`;
      ctx.shadowBlur = 30 * alpha;
      ctx.lineWidth = effect.kind === "miss" ? 2.2 : 3.2;

      const shockwaveRadius = baseRadius + cellSize * (effect.kind === "sunk" ? 1.9 : 1.24) * eased;
      ctx.strokeStyle = `rgba(${color}, ${0.78 * alpha})`;
      ctx.fillStyle = `rgba(${color}, ${0.12 * alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, shockwaveRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (effect.kind === "hit" || effect.kind === "sunk" || effect.kind === "fire") {
        const core = ctx.createRadialGradient(px, py, 0, px, py, cellSize * 0.72);
        core.addColorStop(0, `rgba(255, 255, 220, ${0.9 * alpha})`);
        core.addColorStop(0.24, `rgba(255, 206, 64, ${0.66 * alpha})`);
        core.addColorStop(0.58, `rgba(255, 72, 18, ${0.32 * alpha})`);
        core.addColorStop(1, "rgba(255, 28, 8, 0)");
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(px, py, cellSize * (0.32 + 0.34 * Math.sin(t * Math.PI)), 0, Math.PI * 2);
        ctx.fill();
      }

      if (effect.kind === "rocket") {
        const flash = ctx.createRadialGradient(px, py, 0, px, py, cellSize * 0.9);
        flash.addColorStop(0, `rgba(255, 245, 190, ${0.9 * alpha})`);
        flash.addColorStop(0.38, `rgba(255, 100, 40, ${0.42 * alpha})`);
        flash.addColorStop(1, "rgba(255, 80, 40, 0)");
        ctx.fillStyle = flash;
        ctx.beginPath();
        ctx.arc(px, py, cellSize * (0.25 + 0.75 * eased), 0, Math.PI * 2);
        ctx.fill();
      }

      if (effect.kind === "miss") {
        ctx.strokeStyle = `rgba(210, 245, 255, ${0.72 * alpha})`;
        ctx.fillStyle = `rgba(210, 245, 255, ${0.18 * alpha})`;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.ellipse(
            px,
            py,
            cellSize * (0.24 + i * 0.2 + eased * 0.84),
            cellSize * (0.1 + i * 0.08 + eased * 0.38),
            seededRange(seedBase + i * 5, -0.18, 0.18),
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }
        for (let i = 0; i < 18; i++) {
          const angle = -Math.PI / 2 + seededRange(seedBase + i, -0.82, 0.82);
          const distance = cellSize * seededRange(seedBase + i * 3, 0.28, 1.45) * eased;
          const dropX = px + Math.cos(angle) * distance;
          const dropY = py + Math.sin(angle) * distance + cellSize * 0.56 * t;
          const dropAlpha = alpha * seededRange(seedBase + i * 7, 0.45, 0.95);
          ctx.fillStyle = `rgba(220, 250, 255, ${dropAlpha})`;
          ctx.beginPath();
          ctx.arc(dropX, dropY, seededRange(seedBase + i * 11, 1.3, 3.2), 0, Math.PI * 2);
          ctx.fill();
        }
        for (let i = 0; i < 9; i++) {
          const foamX = px + seededRange(seedBase + i * 61, -0.8, 0.8) * cellSize * eased;
          const foamY = py + seededRange(seedBase + i * 67, -0.18, 0.45) * cellSize;
          ctx.strokeStyle = `rgba(235, 252, 255, ${0.52 * alpha})`;
          ctx.beginPath();
          ctx.arc(foamX, foamY, seededRange(seedBase + i * 71, 1.4, 3.8), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (effect.kind === "hit" || effect.kind === "sunk" || effect.kind === "fire") {
        const flameCount = effect.kind === "sunk" ? 22 : 15;
        for (let i = 0; i < flameCount; i++) {
          const sway = Math.sin(t * Math.PI * 7 + i) * 0.22;
          const angle = -Math.PI / 2 + seededRange(seedBase + i * 5, -0.72, 0.72) + sway;
          const flameLength = cellSize * seededRange(seedBase + i * 9, 0.7, effect.kind === "sunk" ? 2.1 : 1.45) * (0.5 + eased);
          const width = seededRange(seedBase + i * 13, 2.8, 7.2) * alpha;
          const tipX = px + Math.cos(angle) * flameLength;
          const tipY = py + Math.sin(angle) * flameLength;
          const flame = ctx.createLinearGradient(px, py, tipX, tipY);
          flame.addColorStop(0, `rgba(255, 245, 180, ${0.86 * alpha})`);
          flame.addColorStop(0.42, `rgba(255, 110, 24, ${0.72 * alpha})`);
          flame.addColorStop(1, "rgba(255, 40, 10, 0)");
          ctx.strokeStyle = flame;
          ctx.lineWidth = Math.max(1, width);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(
            px + Math.cos(angle + 0.38) * flameLength * 0.45,
            py + Math.sin(angle + 0.38) * flameLength * 0.45,
            tipX,
            tipY,
          );
          ctx.stroke();
        }

        const sparkCount = effect.kind === "sunk" ? 36 : 24;
        for (let i = 0; i < sparkCount; i++) {
          const angle = (Math.PI * 2 * i) / sparkCount + seededRange(seedBase + i * 17, -0.18, 0.18);
          const distance = cellSize * seededRange(seedBase + i * 19, 0.28, effect.kind === "sunk" ? 1.55 : 1.15) * eased;
          const sparkX = px + Math.cos(angle) * distance;
          const sparkY = py + Math.sin(angle) * distance + cellSize * 0.18 * t;
          ctx.fillStyle = `rgba(255, ${Math.round(seededRange(seedBase + i * 23, 150, 235))}, 70, ${alpha})`;
          ctx.beginPath();
          ctx.arc(sparkX, sparkY, seededRange(seedBase + i * 29, 1.2, 3.2) * alpha, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = `rgba(20, 24, 22, ${0.22 * alpha})`;
        for (let i = 0; i < 10; i++) {
          const angle = seededRange(seedBase + i * 31, -Math.PI, Math.PI);
          const smokeX = px + Math.cos(angle) * cellSize * 0.42 * eased;
          const smokeY = py - cellSize * (0.15 + 0.8 * t) + Math.sin(angle) * cellSize * 0.25;
          ctx.beginPath();
          ctx.arc(smokeX, smokeY, cellSize * seededRange(seedBase + i * 37, 0.08, 0.22) * (0.8 + t), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "lighter";
      }

      if (effect.kind === "bubble") {
        ctx.strokeStyle = `rgba(${color}, ${0.75 * alpha})`;
        ctx.fillStyle = `rgba(${color}, ${0.08 * alpha})`;
        for (let i = 0; i < 16; i++) {
          const angle = seededRange(seedBase + i * 41, 0, Math.PI * 2);
          const lift = cellSize * seededRange(seedBase + i * 43, 0.25, 1.25) * eased;
          const bubbleX = px + Math.cos(angle) * cellSize * seededRange(seedBase + i * 47, 0.12, 0.72) * eased;
          const bubbleY = py - lift + Math.sin(angle) * cellSize * 0.18;
          const radiusBubble = cellSize * seededRange(seedBase + i * 53, 0.05, 0.16) * (0.55 + t);
          ctx.beginPath();
          ctx.arc(bubbleX, bubbleY, radiusBubble, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = `rgba(255, 255, 255, ${0.48 * alpha})`;
          ctx.beginPath();
          ctx.arc(bubbleX - radiusBubble * 0.28, bubbleY - radiusBubble * 0.28, radiusBubble * 0.22, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(${color}, ${0.08 * alpha})`;
        }
      }

      if (effect.kind === "intercept") {
        ctx.strokeStyle = `rgba(${color}, ${0.92 * alpha})`;
        for (let i = 0; i < 4; i++) {
          const angle = (Math.PI / 2) * i + t * 2.2;
          const arm = cellSize * (0.35 + 0.85 * eased);
          ctx.beginPath();
          ctx.moveTo(px + Math.cos(angle) * cellSize * 0.16, py + Math.sin(angle) * cellSize * 0.16);
          ctx.lineTo(px + Math.cos(angle) * arm, py + Math.sin(angle) * arm);
          ctx.stroke();
        }
      }

      if (effect.kind === "sunk") {
        ctx.strokeStyle = `rgba(255, 235, 140, ${0.8 * alpha})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(px - cellSize * 0.45, py);
        ctx.lineTo(px + cellSize * 0.45, py);
        ctx.moveTo(px, py - cellSize * 0.45);
        ctx.lineTo(px, py + cellSize * 0.45);
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
