// apps/web/src/hooks/usePhaseTransition.ts
// Хук: смена игровой фазы через нативный View Transitions API.
// Фоллбэк для браузеров без поддержки: просто вызывает setPhase напрямую.
"use client";

import type { GamePhase } from "@radioboi/game-core";
import { useGameStore } from "@/src/store/gameStore";

/**
 * Возвращает функцию `changePhase`, которая переключает фазу игры
 * с анимацией View Transitions API (если браузер поддерживает).
 *
 * Использование:
 * ```tsx
 * const changePhase = usePhaseTransition();
 * changePhase("battle"); // запускает CSS transition + меняет стор
 * ```
 *
 * Кастомизация анимации — через CSS `::view-transition-*` псевдоэлементы
 * в globals.css или utilities.css.
 */
export function usePhaseTransition(): (newPhase: GamePhase) => void {
  const setPhase = useGameStore((s) => s.setPhase);

  return (newPhase: GamePhase) => {
    // Проверяем наличие API в браузере (нет в Safari <18, Firefox <130)
    if (typeof document !== "undefined" && "startViewTransition" in document) {
      document.startViewTransition(() => {
        setPhase(newPhase);
      });
    } else {
      // Фоллбэк: немедленное переключение без анимации
      setPhase(newPhase);
    }
  };
}