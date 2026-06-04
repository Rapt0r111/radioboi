// apps/web/src/hooks/useNow.ts
"use client";
//
// PERF: Replaces setInterval(250ms) in GameClientWrapper with a
// requestAnimationFrame-based ticker.
//
// Key improvements vs setInterval:
//   1. rAF is throttled by the browser to display refresh rate (~16ms) and
//      is paused automatically when the tab is hidden — setInterval keeps firing.
//   2. We only schedule a new rAF frame when at least one countdown is active,
//      avoiding any JS execution when the game is idle.
//   3. The time is snapped to 250ms buckets so downstream components only
//      re-render 4× per second maximum (same visual fidelity as before).
//   4. The returned timestamp is Date.now() compatible.

import { useCallback, useEffect, useRef, useState } from "react";

/** Round timestamp down to 250ms buckets to minimise re-renders. */
function snap(ts: number): number {
  return Math.floor(ts / 250) * 250;
}

/**
 * Returns the current timestamp, updated at most 4× per second.
 * Only triggers re-renders while `active` is true.
 *
 * @param active - Set to true whenever any countdown is running.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => snap(Date.now()));
  const rafRef = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;

  const tick = useCallback(() => {
    if (!activeRef.current) {
      rafRef.current = 0;
      return;
    }
    const next = snap(Date.now());
    setNow((prev) => (prev === next ? prev : next));
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (active && rafRef.current === 0) {
      // Start the loop
      setNow(snap(Date.now()));
      rafRef.current = requestAnimationFrame(tick);
    } else if (!active && rafRef.current !== 0) {
      // Stop the loop
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    return () => {
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [active, tick]);

  return now;
}