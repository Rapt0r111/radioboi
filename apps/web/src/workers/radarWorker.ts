// apps/web/src/workers/radarWorker.ts
// OffscreenCanvas renderer for the radar, missiles, and battle effects.
// Rendering is capped at 30 FPS in every state; all effect geometry uses
// random per-event entropy and the particle hot path is allocation-free.

import { expose } from "comlink";

// ── Types ─────────────────────────────────────────────────────────────────────

type MissileEntry = {
  x: number;
  y: number;
  progress: number;
  startedAt: number;
  durationMs: number;
};

type EffectKind = "hit" | "miss" | "sunk" | "intercept" | "rocket";

type EffectEntry = {
  kind: EffectKind;
  x: number;
  y: number;
  startedAt: number;
  /** Random per-event entropy, independent of the board coordinate. */
  seed: number;
  durationMs?: number;
};

type GridBounds = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

// Every visual shares one fixed budget: the sweep must not fall back to 10 FPS
// after missiles/effects are gone.
const FRAME_INTERVAL_MS = 1_000 / 30;
// Queue rAF shortly before its target so a 60 Hz screen can use that v-sync.
const FRAME_TIMER_LEAD_MS = 5;
const RADAR_RADIANS_PER_MS = 0.022 / FRAME_INTERVAL_MS;
const DEFAULT_MISSILE_FLIGHT_DURATION_MS = 850;
const DEFAULT_ROCKET_EFFECT_DURATION_MS = 600;

// ── Pure math helpers (no closures, no allocations in hot path) ───────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeOut(v: number): number {
  const t = clamp01(v);
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

function seededUnit(seed: number): number {
  // Integer hashing is substantially cheaper than Math.sin in the particle
  // hot path and remains deterministic during one effect's lifetime.
  let x = seed | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 0x1_0000_0000;
}

function seededRange(seed: number, min: number, max: number): number {
  return min + seededUnit(seed) * (max - min);
}

function randomEffectSeed(): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const entropy = new Uint32Array(1);
    crypto.getRandomValues(entropy);
    return entropy[0] ?? 0;
  }

  // Web Crypto is present in supported workers. Keep a non-fixed fallback for
  // test and embedded environments so a reload cannot restore one template.
  return ((performance.now() * 1_000) ^ (Math.random() * 0x1_0000_0000)) >>> 0;
}

function effectDuration(kind: EffectKind): number {
  switch (kind) {
    case "sunk":      return 2_000;
    // Keep each radar impact alive for the same audible window instead of
    // cutting visual feedback off while the recording is still playing.
    case "miss":      return 1_672;
    case "hit":       return 2_000;
    case "rocket":    return DEFAULT_ROCKET_EFFECT_DURATION_MS;
    case "intercept": return 750;
  }
}

// PERF-7: Pre-built color tables — no string interpolation per frame
const EFFECT_COLOR: Record<EffectKind, string> = {
  hit:       "135,149,147",
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
  // PERF-1: at most one timer or one rAF can be pending at once.
  #rafId = 0;
  #frameTimer: ReturnType<typeof setTimeout> | null = null;
  #lastFrameAt = 0;
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

  updateMissile(id: string, x: number, y: number, progress: number, durationMs?: number): void {
    const existing = this.#missiles.get(id);
    this.#missiles.set(id, {
      x, y, progress,
      startedAt: existing?.startedAt ?? performance.now(),
      durationMs: Math.max(
        1,
        durationMs ?? existing?.durationMs ?? DEFAULT_MISSILE_FLIGHT_DURATION_MS,
      ),
    });
    this.#scheduleFrame();
  }

  removeMissile(id: string): void {
    this.#missiles.delete(id);
  }

  triggerEffect(kind: EffectKind, x: number, y: number, durationMs?: number): void {
    this.#effects.push({
      kind,
      x,
      y,
      startedAt: performance.now(),
      seed: randomEffectSeed(),
      ...(durationMs === undefined ? {} : { durationMs: Math.max(1, durationMs) }),
    });
    this.#scheduleFrame();
  }

  // rAF provides the compositor boundary while the clock gate keeps every
  // state (idle, missile, and impact) at one stable 30 FPS cadence.
  #scheduleFrame(): void {
    if (!this.#canvas || this.#rafId !== 0 || this.#frameTimer !== null) return;

    const elapsed = this.#lastFrameAt === 0
      ? FRAME_INTERVAL_MS
      : performance.now() - this.#lastFrameAt;
    const delay = Math.max(0, FRAME_INTERVAL_MS - elapsed - FRAME_TIMER_LEAD_MS);

    const requestDraw = () => {
      this.#rafId = requestAnimationFrame((timestamp) => {
        this.#rafId = 0;
        const frameElapsed = this.#lastFrameAt === 0
          ? FRAME_INTERVAL_MS
          : timestamp - this.#lastFrameAt;

        if (frameElapsed + 0.25 < FRAME_INTERVAL_MS) {
          this.#scheduleFrame();
          return;
        }

        this.#lastFrameAt = timestamp;
        this.#draw(frameElapsed);
      });
    };

    if (delay === 0) {
      requestDraw();
      return;
    }

    this.#frameTimer = setTimeout(() => {
      this.#frameTimer = null;
      requestDraw();
    }, delay);
  }

  #draw(frameElapsed: number): void {
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

    // Time-based movement keeps its speed stable if a v-sync is missed.
    this.#radarAngle = (this.#radarAngle + RADAR_RADIANS_PER_MS * frameElapsed) % (Math.PI * 2);

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
      (e) => now - e.startedAt < (e.durationMs ?? effectDuration(e.kind)),
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

    for (const [id, m] of this.#missiles) {
      if (now - m.startedAt >= m.durationMs) {
        // A flight is a one-shot animation. Do not leave the rocket parked at
        // the target while the turn/intercept result is still being resolved.
        this.#missiles.delete(id);
        continue;
      }
      const tx = offsetX + m.x * gw;
      const ty = offsetY + m.y * gh;
      const travel = Math.max(
        clamp01(m.progress),
        clamp01((now - m.startedAt) / m.durationMs),
      );
      // Linear travel keeps the rocket moving through the full `flying`
      // recording instead of reaching the target early and appearing frozen.
      const launch = travel;
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
      const dur = effect.durationMs ?? effectDuration(effect.kind);
      if (age >= dur) continue;

      const px = offsetX + effect.x * gw;
      const py = offsetY + effect.y * gh;
      const t = age / dur;
      const eased = easeOut(t);
      const alpha = 1 - t;
      const color = EFFECT_COLOR[effect.kind];
      const seed = effect.seed;
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
          this.#drawFireEffect(ctx, px, py, t, eased, alpha, cellSize, seed);
          this.#drawSmokeEffect(ctx, px, py, t, eased, alpha, cellSize, seed);
          break;
        case "sunk":
          this.#drawSmokeEffect(ctx, px, py, t, eased, alpha, cellSize, seed + 401);
          this.#drawFireEffect(ctx, px, py, t, eased, alpha, cellSize, seed);
          break;
        case "miss":
          this.#drawMissEffect(ctx, px, py, t, eased, alpha, cellSize, seed);
          break;
        case "rocket":
          this.#drawRocketFlash(ctx, px, py, t, eased, alpha, cellSize);
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
  ): void {
    // Core bloom
    ctx.fillStyle = `rgba(255,215,75,${(0.55 * alpha).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(px, py, cellSize * (0.26 + 0.26 * Math.sin(t * Math.PI)), 0, Math.PI * 2);
    ctx.fill();

    // A ship destruction gets one compact fire plume, not duplicated overlays.
    const rayCount = 10;
    for (let i = 0; i < rayCount; i++) {
      const sway = Math.sin(t * Math.PI * 6 + i) * 0.18;
      const ang = -Math.PI / 2 + seededRange(seed + i * 5, -0.62, 0.62) + sway;
      const len = cellSize * seededRange(seed + i * 9, 0.55, 1.65) * (0.4 + eased);
      const w = Math.max(1, seededRange(seed + i * 13, 2.2, 5.5) * alpha);
      ctx.strokeStyle = `rgba(255,${Math.round(seededRange(seed + i * 7, 85, 215))},22,${(0.62 * alpha).toFixed(2)})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      ctx.stroke();
    }

    const sparkCount = 10;
    for (let i = 0; i < sparkCount; i++) {
      const ang = (Math.PI * 2 * i) / sparkCount + seededRange(seed + i * 17, -0.14, 0.14);
      const dist = cellSize * seededRange(seed + i * 19, 0.22, 1.2) * eased;
      const sx = px + Math.cos(ang) * dist;
      const sy = py + Math.sin(ang) * dist + cellSize * 0.12 * t;
      ctx.fillStyle = `rgba(255,${Math.round(seededRange(seed + i * 23, 155, 225))},70,${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, seededRange(seed + i * 29, 1, 2.4) * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  #drawSmokeEffect(
    ctx: OffscreenCanvasRenderingContext2D,
    px: number, py: number,
    t: number, eased: number, alpha: number,
    cellSize: number, seed: number,
  ): void {
    // A hit is a visible smoke plume, not a second fireball. Eight procedural
    // clouds keep the hit legible at board scale and cost less than flame rays/sparks.
    ctx.globalCompositeOperation = "source-over";

    for (let i = 0; i < 8; i++) {
      const drift = seededRange(seed + i * 31, -0.68, 0.68) * cellSize * eased;
      const rise = seededRange(seed + i * 43, 0.04, 1.1) * cellSize * eased;
      const radius = seededRange(seed + i * 59, 0.16, 0.34) * cellSize * (0.64 + 0.62 * eased);
      ctx.fillStyle = i % 3 === 0 ? "rgb(188, 198, 191)" : i % 3 === 1 ? "rgb(129, 142, 135)" : "rgb(87, 101, 96)";
      ctx.globalAlpha = alpha * seededRange(seed + i * 71, 0.4, 0.78);
      ctx.beginPath();
      ctx.arc(px + drift, py - rise + cellSize * t * 0.08, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "lighter";
  }

  #drawMissEffect(
    ctx: OffscreenCanvasRenderingContext2D,
    px: number, py: number,
    t: number, eased: number, alpha: number,
    cellSize: number, seed: number,
  ): void {
    ctx.strokeStyle = `rgba(210,245,255,${(0.62 * alpha).toFixed(2)})`;
    ctx.lineWidth = 1.8;

    // Two rings preserve the splash read with less Canvas work.
    for (let i = 0; i < 2; i++) {
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

    // Seven droplets are enough at a cell-sized target.
    for (let i = 0; i < 7; i++) {
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

  #drawRocketFlash(
    ctx: OffscreenCanvasRenderingContext2D,
    px: number, py: number,
    t: number, eased: number, alpha: number,
    cellSize: number,
  ): void {
    // Remote clients do not receive the target coordinate. Give them a short
    // directional flight path from the radar centre while the `flying` sample
    // is playing, without exposing where the missile will land.
    const angle = -Math.PI * 0.72;
    const distance = cellSize * (0.28 + 1.55 * t);
    const rocketX = px + Math.cos(angle) * distance;
    const rocketY = py + Math.sin(angle) * distance;
    const tailX = px + Math.cos(angle) * distance * 0.52;
    const tailY = py + Math.sin(angle) * distance * 0.52;
    const radius = cellSize * (0.12 + 0.2 * (1 - t));

    ctx.strokeStyle = `rgba(255,150,25,${(0.62 * alpha).toFixed(2)})`;
    ctx.lineWidth = Math.max(2, cellSize * 0.07);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    ctx.fillStyle = `rgba(255,245,175,${(0.88 * alpha).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(rocketX, rocketY, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(255,116,28,${(0.76 * alpha).toFixed(2)})`;
    ctx.lineWidth = Math.max(1, cellSize * 0.04);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const rayAngle = (Math.PI / 2) * i + eased * 0.32;
      ctx.moveTo(rocketX + Math.cos(rayAngle) * radius * 0.42, rocketY + Math.sin(rayAngle) * radius * 0.42);
      ctx.lineTo(rocketX + Math.cos(rayAngle) * radius * 1.34, rocketY + Math.sin(rayAngle) * radius * 1.34);
    }
    ctx.stroke();
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
