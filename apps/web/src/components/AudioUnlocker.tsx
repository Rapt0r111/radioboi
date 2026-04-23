// apps/web/src/components/AudioUnlocker.tsx
"use client";

// Разблокировка Web Audio API после первого взаимодействия пользователя.
//
// Браузеры блокируют AudioContext до жеста пользователя (браузерная политика).
// Компонент перехватывает первый pointerdown или keydown на уровне document,
// вызывает engine.resume() и затем ПОЛНОСТЬЮ удаляет себя из дерева.
//
// Использование:
//   <AudioUnlocker engine={morseEngineInstance} />
//
// После разблокировки рендерит null — никакого DOM-следа не остаётся.

import type { MorseEngine } from "@radioboi/morse-engine";
import { useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

type Props = {
  /**
   * Экземпляр MorseEngine, у которого нужно вызвать .resume().
   * Передаётся снаружи, чтобы компонент не зависел от глобального синглтона.
   */
  engine: MorseEngine;
  /** Опциональный callback после успешной разблокировки */
  onUnlocked?: () => void;
};

// ── Компонент ─────────────────────────────────────────────────────────────────

/**
 * Невидимый «разблокировщик» AudioContext.
 *
 * Регистрирует слушатели событий на document через addEventListener,
 * а не через JSX-атрибуты (иначе потребовался бы overlay поверх всего UI).
 * После разблокировки размонтирует слушатели через cleanup useEffect.
 */
export function AudioUnlocker({ engine, onUnlocked }: Props): null {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const onUnlockedRef = useRef(onUnlocked);
  onUnlockedRef.current = onUnlocked;

  useEffect(() => {
    // Если AudioContext уже разблокирован (например, был создан после взаимодействия)
    if (engine.state === "running") {
      setIsUnlocked(true);
      return;
    }

    let didUnlock = false;

    async function unlock(): Promise<void> {
      // Защита от двойного вызова (pointerdown + keydown могут прийти одновременно)
      if (didUnlock) return;
      didUnlock = true;

      try {
        await engine.resume();
        setIsUnlocked(true);
        onUnlockedRef.current?.();
      } catch (err) {
        // resume() может бросить если AudioContext уже закрыт
        console.warn("[AudioUnlocker] resume() failed:", err);
        didUnlock = false; // разрешаем повторную попытку
      } finally {
        removeListeners();
      }
    }

    function handlePointerDown(): void {
      void unlock();
    }

    function handleKeyDown(): void {
      void unlock();
    }

    function removeListeners(): void {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    }

    // passive: true важно для производительности (не блокируем scroll)
    document.addEventListener("pointerdown", handlePointerDown, { once: true, passive: true });
    document.addEventListener("keydown", handleKeyDown, { once: true, passive: true });

    return removeListeners;
  }, [engine]);

  // После разблокировки компонент полностью прекращает рендеринг
  if (isUnlocked) return null;

  // До разблокировки тоже ничего не рендерим — слушатели на document
  return null;
}