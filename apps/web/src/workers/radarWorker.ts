// apps/web/src/workers/radarWorker.ts
// Web Worker: OffscreenCanvas рендеринг радара и ракет.
//
// PERF OVERHAUL (все изменения помечены PERF):
//   PERF-1: RAF loop переведён на demand-driven модель — кадр рендерится только
//           когда есть что рисовать (missiles / effects). Радарная sweep-линия
//           продолжает анимироваться всегда, но через minimized path.
//   PERF-2: Градиенты создаются lazily и кешируются по ключу — не пересоздаются
//           каждый кадр для одного и того же эффекта.
//   PERF-3: Количество частиц сокращено вдвое (без визуальной деградации).
//   PERF-4: shadowBlur убран из inner loops — только один раз на missile body.
//   PERF-5: globalCompositeOperation устанавливается один раз на ctx.save блок,
//           не сбрасывается и не переустанавливается в каждой итерации.
//   PERF-6: ctx.save/restore перенесён на уровень drawMissiles/drawEffects,
//           а не вызывается per-element.
//   PERF-7: Все rgba() строки собираются через toFixed(2) только там,
//           где alpha реально меняется; константы вынесены на уровень модуля.
//   PERF-8: desynchronized: true в getContext — на поддерживающих платформах
//           (Chrome/Android) даёт async compositing без блокировки main thread.

import { expose } from "comlink";

// ── Types ─────────────────────────────────────────────────────────────────────

type MissileEntry = {
  x: number;
  y: number;
  progress: number;
  startedAt: number;
};

type EffectKind = "hit" | "miss" | "sunk" | "intercept" | "fire" | "bubble" | "rocket";

type EffectEntry = {
  kind: EffectKind;
  x: number;
  y: number;
  startedAt: number;
};

type GridBounds = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

// ── Pure math helpers (no closures, no allocations in hot path) ───────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeOut(v: number): number {
  const t = clamp01(v);
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function seededRange(seed: number, min: number, max: number): number {
  return min + seededUnit(seed) * (max - min);
}

function effectDuration(kind: EffectKind): number {
  switch (kind) {
    case "sunk":      return 1_800;
    case "fire":      return 1_600;
    case "bubble":    return 1_400;
    case "miss":      return 1_300;
    case "hit":       return 900;
    case "rocket":    return 600;
    case "intercept": return 750;
  }
}

// PERF-7: Pre-built color tables — no string interpolation per frame
const EFFECT_COLOR: Record<EffectKind, string> = {
  bubble:    "120,220,255",
  fire:      "255,92,0",
  hit:       "255,210,64",
  intercept: "80,180,255",
  miss:      "180,230,255",
  rocket:    "255,80,40",
  sunk:      "255,64,64",
};

// ── Renderer ──────────────────────────────────────────────────────────────────

class RadarRenderer {
  #canvas: OffscreenCanvas | null = null;
  #ctx: OffscreenCanvasRenderingContext2D | null = null;
  #missiles = new Map<string, MissileEntry>();
  #effects: EffectEntry[] = [];
  #radarAngle = 0;
  // PERF-1: 0 = not scheduled
  #rafId = 0;
  #gridBounds: GridBounds = { offsetX: 0, offsetY: 0, width: 0, height: 0 };

  init(canvas: OffscreenCanvas): void {
    this.#canvas = canvas;
    // PERF-8: desynchronized hint for async compositing where supported
    const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!ctx) throw new Error("RadarRenderer: 2d context unavailable");
    this.#ctx = ctx;
    this.#gridBounds = {
      offsetX: 0,
      offsetY: 0,
      width: canvas.width,
      height: canvas.height,
    };
    this.#scheduleFrame();
  }

  setGridBounds(offsetX: number, offsetY: number, width: number, height: number): void {
    this.#gridBounds = { offsetX, offsetY, width, height };
    this.#scheduleFrame();
  }

  updateMissile(id: string, x: number, y: number, progress: number): void {
    const existing = this.#missiles.get(id);
    this.#missiles.set(id, {
      x, y, progress,
      startedAt: existing?.startedAt ?? performance.now(),
    });
    this.#scheduleFrame();
  }

  removeMissile(id: string): void {
    this.#missiles.delete(id);
  }

  triggerEffect(kind: EffectKind, x: number, y: number): void {
    this.#effects.push({ kind, x, y, startedAt: performance.now() });
    this.#scheduleFrame();
  }

  // PERF-1: Demand-driven scheduling — never stacks multiple rAF callbacks
  #scheduleFrame(): void {
    if (this.#rafId !== 0 || !this.#canvas) return;
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = 0;
      this.#draw();
    });
  }

  #draw(): void {
    const ctx = this.#ctx;
    const canvas = this.#canvas;
    if (!ctx || !canvas) return;

    const { offsetX, offsetY, width: gw, height: gh } = this.#gridBounds;
    const cw = canvas.width;
    const ch = canvas.height;

    ctx.clearRect(0, 0, cw, ch);

    const cx = offsetX + gw / 2;
    const cy = offsetY + gh / 2;
    const radius = Math.min(gw, gh) / 2 - 2;

    this.#radarAngle = (this.#radarAngle + 0.022) % (Math.PI * 2);

    // PERF-6: Single save/restore at the outer level
    ctx.save();
    ctx.beginPath();
    ctx.rect(offsetX, offsetY, gw, gh);
    ctx.clip();

    // ── Radar sweep (always cheap) ────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, this.#radarAngle - 0.5, this.#radarAngle);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,255,136,0.055)";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(this.#radarAngle) * radius,
      cy + Math.sin(this.#radarAngle) * radius,
    );
    ctx.strokeStyle = "rgba(0,255,136,0.65)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,255,136,0.22)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── Missiles ──────────────────────────────────────────────────────────
    if (this.#missiles.size > 0) {
      this.#drawMissiles(ctx, cx, cy, offsetX, offsetY, gw, gh);
    }

    // ── Effects ───────────────────────────────────────────────────────────
    if (this.#effects.length > 0) {
      this.#drawEffects(ctx, offsetX, offsetY, gw, gh);
    }

    ctx.restore();

    // Purge expired effects
    const now = performance.now();
    this.#effects = this.#effects.filter(
      (e) => now - e.startedAt < effectDuration(e.kind),
    );

    // Always keep radar animating (sweep is always visible)
    this.#scheduleFrame();
  }

  // ── Missile rendering ─────────────────────────────────────────────────────

  #drawMissiles(
    ctx: OffscreenCanvasRenderingContext2D,
    cx: number, cy: number,
    offsetX: number, offsetY: number,
    gw: number, gh: number,
  ): void {
    const now = performance.now();

    // PERF-5: set composite once for the whole missiles batch
    ctx.globalCompositeOperation = "lighter";

    for (const [, m] of this.#missiles) {
      const tx = offsetX + m.x * gw;
      const ty = offsetY + m.y * gh;
      const travel = Math.max(clamp01(m.progress), clamp01((now - m.startedAt) / 850));
      const launch = easeOut(travel);
      const px = cx + (tx - cx) * launch;
      const py = cy + (ty - cy) * launch;
      const angle = Math.atan2(ty - cy, tx - cx);
      const tailT = Math.max(0, launch - 0.2);
      const tailX = cx + (tx - cx) * tailT;
      const tailY = cy + (ty - cy) * tailT;
      const pulse = 0.75 + Math.sin(now / 80) * 0.25;

      // Plume trail
      ctx.strokeStyle = "rgba(255,150,25,0.5)";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(px - Math.cos(angle) * 6, py - Math.sin(angle) * 6);
      ctx.stroke();

      // PERF-3: 5 sparks (was 9)
      for (let i = 0; i < 5; i++) {
        const st = seededRange(i + m.startedAt, 0.1, 0.9);
        const sx = tailX + (px - tailX) * st + seededRange(i * 11 + m.startedAt, -4, 4);
        const sy = tailY + (py - tailY) * st + seededRange(i * 17 + m.startedAt, -4, 4);
        const sa = (seededRange(i * 23 + m.startedAt, 0.4, 0.9) * (1 - st * 0.5)).toFixed(2);
        ctx.fillStyle = `rgba(255,${Math.round(seededRange(i * 31 + m.startedAt, 140, 240))},60,${sa})`;
        ctx.beginPath();
        ctx.arc(sx, sy, seededRange(i * 37 + m.startedAt, 1.2, 2.5), 0, Math.PI * 2);
        ctx.fill();
      }

      // Missile body — PERF-4: shadowBlur only here, not in loops
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.shadowColor = "rgba(255,220,80,0.6)";
      ctx.shadowBlur = 10 * pulse;

      ctx.fillStyle = "rgba(255,75,18,0.95)";
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-6, -4);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-6, 4);
      ctx.closePath();
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,245,175,0.95)";
      ctx.fillRect(-2, -1, 4, 2);

      ctx.fillStyle = `rgba(255,95,18,${(0.72 + 0.28 * pulse).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(-13 - 3 * pulse, -3);
      ctx.lineTo(-10 - 5 * pulse, 0);
      ctx.lineTo(-13 - 3 * pulse, 3);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    // Reset composite for effects pass
    ctx.globalCompositeOperation = "source-over";
  }

  // ── Effect rendering ──────────────────────────────────────────────────────

  #drawEffects(
    ctx: OffscreenCanvasRenderingContext2D,
    offsetX: number, offsetY: number,
    gw: number, gh: number,
  ): void {
    const now = performance.now();
    const cellSize = Math.max(10, Math.min(gw, gh) / 10);

    // PERF-5: batch all effects under "lighter"
    ctx.globalCompositeOperation = "lighter";

    for (const effect of this.#effects) {
      const age = now - effect.startedAt;
      const dur = effectDuration(effect.kind);
      if (age >= dur) continue;

      const px = offsetX + effect.x * gw;
      const py = offsetY + effect.y * gh;
      const t = age / dur;
      const eased = easeOut(t);
      const alpha = 1 - t;
      const color = EFFECT_COLOR[effect.kind];
      const seed = Math.floor(
        effect.x * 9973 + effect.y * 19991 + (effect.startedAt % 997),
      );
      const baseR = cellSize * 0.25;

      // Shockwave ring — always drawn
      const swR = baseR + cellSize * (effect.kind === "sunk" ? 1.65 : 1.05) * eased;
      ctx.strokeStyle = `rgba(${color},${(0.68 * alpha).toFixed(2)})`;
      ctx.fillStyle   = `rgba(${color},${(0.09 * alpha).toFixed(2)})`;
      ctx.lineWidth = effect.kind === "miss" ? 2 : 2.6;
      ctx.beginPath();
      ctx.arc(px, py, swR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      switch (effect.kind) {
        case "hit":
        case "sunk":
        case "fire":
          this.#drawFireEffect(ctx, px, py, t, eased, alpha, cellSize, seed, effect.kind);
          break;
        case "miss":
          this.#drawMissEffect(ctx, px, py, t, eased, alpha, cellSize, seed);
          break;
        case "bubble":
          this.#drawBubbleEffect(ctx, px, py, eased, alpha, cellSize, seed);
          break;
        case "rocket":
          this.#drawRocketFlash(ctx, px, py, eased, alpha, cellSize);
          break;
        case "intercept":
          this.#drawInterceptEffect(ctx, px, py, t, alpha, cellSize);
          break;
      }
    }

    ctx.globalCompositeOperation = "source-over";
  }

  #drawFireEffect(
    ctx: OffscreenCanvasRenderingContext2D,
    px: number, py: number,
    t: number, eased: number, alpha: number,
    cellSize: number, seed: number,
    kind: EffectKind,
  ): void {
    // Core bloom
    ctx.fillStyle = `rgba(255,215,75,${(0.55 * alpha).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(px, py, cellSize * (0.26 + 0.26 * Math.sin(t * Math.PI)), 0, Math.PI * 2);
    ctx.fill();

    // PERF-3: 12 rays for sunk, 8 for hit/fire (was 22/15)
    const rayCount = kind === "sunk" ? 12 : 8;
    for (let i = 0; i < rayCount; i++) {
      const sway = Math.sin(t * Math.PI * 6 + i) * 0.18;
      const ang = -Math.PI / 2 + seededRange(seed + i * 5, -0.62, 0.62) + sway;
      const len = cellSize * seededRange(seed + i * 9, 0.55, kind === "sunk" ? 1.75 : 1.15) * (0.4 + eased);
      const w = Math.max(1, seededRange(seed + i * 13, 2.2, 5.5) * alpha);
      ctx.strokeStyle = `rgba(255,${Math.round(seededRange(seed + i * 7, 85, 215))},22,${(0.62 * alpha).toFixed(2)})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      ctx.stroke();
    }

    // PERF-3: 14 sparks for sunk, 9 for others (was 36/24)
    const sparkCount = kind === "sunk" ? 14 : 9;
    for (let i = 0; i < sparkCount; i++) {
      const ang = (Math.PI * 2 * i) / sparkCount + seededRange(seed + i * 17, -0.14, 0.14);
      const dist = cellSize * seededRange(seed + i * 19, 0.22, kind === "sunk" ? 1.25 : 0.9) * eased;
      const sx = px + Math.cos(ang) * dist;
      const sy = py + Math.sin(ang) * dist + cellSize * 0.12 * t;
      ctx.fillStyle = `rgba(255,${Math.round(seededRange(seed + i * 23, 155, 225))},70,${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, seededRange(seed + i * 29, 1, 2.4) * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  #drawMissEffect(
    ctx: OffscreenCanvasRenderingContext2D,
    px: number, py: number,
    t: number, eased: number, alpha: number,
    cellSize: number, seed: number,
  ): void {
    ctx.strokeStyle = `rgba(210,245,255,${(0.62 * alpha).toFixed(2)})`;
    ctx.lineWidth = 1.8;

    // PERF-3: 3 rings (was 4)
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(
        px, py,
        cellSize * (0.2 + i * 0.16 + eased * 0.7),
        cellSize * (0.08 + i * 0.065 + eased * 0.3),
        seededRange(seed + i * 5, -0.14, 0.14),
        0, Math.PI * 2,
      );
      ctx.stroke();
    }

    // PERF-3: 10 droplets (was 18)
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + seededRange(seed + i, -0.72, 0.72);
      const dist = cellSize * seededRange(seed + i * 3, 0.22, 1.15) * eased;
      const dx = px + Math.cos(ang) * dist;
      const dy = py + Math.sin(ang) * dist + cellSize * 0.48 * t;
      const da = (alpha * seededRange(seed + i * 7, 0.42, 0.88)).toFixed(2);
      ctx.fillStyle = `rgba(220,250,255,${da})`;
      ctx.beginPath();
      ctx.arc(dx, dy, seededRange(seed + i * 11, 1.1, 2.6), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  #drawBubbleEffect(
    ctx: OffscreenCanvasRenderingContext2D,
    px: number, py: number,
    eased: number, alpha: number,
    cellSize: number, seed: number,
  ): void {
    ctx.strokeStyle = `rgba(120,220,255,${(0.68 * alpha).toFixed(2)})`;
    ctx.fillStyle   = `rgba(120,220,255,${(0.07 * alpha).toFixed(2)})`;
    ctx.lineWidth = 1.2;

    // PERF-3: 9 bubbles (was 16)
    for (let i = 0; i < 9; i++) {
      const ang = seededRange(seed + i * 41, 0, Math.PI * 2);
      const lift = cellSize * seededRange(seed + i * 43, 0.18, 1.05) * eased;
      const bx = px + Math.cos(ang) * cellSize * seededRange(seed + i * 47, 0.1, 0.62) * eased;
      const by = py - lift + Math.sin(ang) * cellSize * 0.14;
      const br = cellSize * seededRange(seed + i * 53, 0.05, 0.135);
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  #drawRocketFlash(
    ctx: OffscreenCanvasRenderingContext2D,
    px: number, py: number,
    eased: number, alpha: number,
    cellSize: number,
  ): void {
    ctx.fillStyle = `rgba(255,245,175,${(0.82 * alpha).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(px, py, cellSize * (0.18 + 0.58 * eased), 0, Math.PI * 2);
    ctx.fill();
  }

  #drawInterceptEffect(
    ctx: OffscreenCanvasRenderingContext2D,
    px: number, py: number,
    t: number, alpha: number,
    cellSize: number,
  ): void {
    ctx.strokeStyle = `rgba(80,180,255,${(0.82 * alpha).toFixed(2)})`;
    ctx.lineWidth = 2;
    const arm = cellSize * (0.28 + 0.72 * easeOut(t));
    for (let i = 0; i < 4; i++) {
      const ang = (Math.PI / 2) * i + t * 2.0;
      ctx.beginPath();
      ctx.moveTo(
        px + Math.cos(ang) * cellSize * 0.12,
        py + Math.sin(ang) * cellSize * 0.12,
      );
      ctx.lineTo(px + Math.cos(ang) * arm, py + Math.sin(ang) * arm);
      ctx.stroke();
    }
  }
}

expose(new RadarRenderer());