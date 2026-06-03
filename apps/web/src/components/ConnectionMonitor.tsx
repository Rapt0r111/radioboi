// apps/web/src/components/ConnectionMonitor.tsx
"use client";

// Монитор сетевого соединения.
//
// • Подписывается на статус GameClient через onStatusChange().
// • При потере соединения показывает красную плашку поверх всего UI.
// • Кнопка «Форсировать синхронизацию» переподключает WebSocket.
//   Сервер (GameRoomArbitrator) отправляет SYNC_STATE при каждом
//   подключении (в fetch-хендлере). gameClient.ts автоматически
//   применяет SYNC_STATE через store.syncFromServer().
//
// Рендерится рядом с игровым экраном — не требует обёртки всего приложения.

import { useEffect, useState } from "react";
import {
  type ConnectionStatus,
  getGameClient,
} from "@/src/lib/network/gameClient";
import { useGameStore } from "@/src/store/gameStore";

// ── Component ─────────────────────────────────────────────────────────────────

export function ConnectionMonitor() {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [isSyncing, setIsSyncing] = useState(false);

  const playerId = useGameStore((s) => s.playerId);
  const roomId = useGameStore((s) => s.roomId);

  // ── Подписка на статус GameClient ────────────────────────────────────────
  useEffect(() => {
    // GameClient может быть ещё не создан в момент монтирования компонента.
    // getGameClient() создаёт синглтон; безопасно вызывать только в браузере.
    let client: ReturnType<typeof getGameClient>;
    try {
      client = getGameClient();
    } catch {
      // SSR или окружение без window — компонент ничего не делает
      return;
    }

    // Синхронизируем начальный статус
    setStatus(client.status);

    const unsubscribe = client.onStatusChange((next) => {
      setStatus(next);
      // Автоматически снимаем флаг синхронизации после подключения
      if (next === "connected") {
        setIsSyncing(false);
      }
    });

    return unsubscribe;
  }, []);

  // ── Форсированная синхронизация ──────────────────────────────────────────

  function handleForceSync(): void {
    if (!roomId || !playerId || isSyncing) return;

    setIsSyncing(true);

    // Keep the same GameClient instance so existing event subscriptions stay alive.
    try {
      const client = getGameClient();
      if (client.status === "disconnected") {
        client.connect(roomId, playerId, "Player");
      } else {
        client.reconnect();
      }
    } catch (err) {
      console.error("[ConnectionMonitor] forceSync failed:", err);
      setIsSyncing(false);
    }
  }

  // ── Условный рендер ───────────────────────────────────────────────────────
  // Показываем баннер только при активном разрыве, не при первом соединении.
  // Если roomId отсутствует — игра ещё не началась, баннер не нужен.
  const isLost = (status === "disconnected" || status === "reconnecting") && roomId !== null;

  if (!isLost) return null;

  return (
    // z-[100] гарантирует отображение поверх CRT-оверлея (z-10) и прочих слоёв
    <div
      role="status"
      aria-live="assertive"
      aria-label="Статус соединения"
      className="
        fixed inset-x-0 top-0 z-[100]
        flex items-center justify-between gap-4
        border-b border-[var(--color-hit-red)]/60
        bg-[var(--color-ocean-950)]/95 px-4 py-2.5
        backdrop-blur-sm
        font-mono
      "
      style={{
        // Красное свечение вдоль верхней границы
        boxShadow: "0 0 16px rgba(255, 59, 59, 0.35), 0 1px 0 rgba(255,59,59,0.3)",
      }}
    >
      {/* ── Индикатор статуса ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 min-w-0">
        {/* Мигающий красный огонь */}
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-hit-red)]"
          aria-hidden="true"
          style={{ animation: "morse-blink 0.8s step-end infinite" }}
        />

        <span className="truncate text-[10px] uppercase tracking-[0.18em] text-[var(--color-hit-red)]">
          {status === "reconnecting" ? "ПЕРЕПОДКЛЮЧЕНИЕ..." : "ПОТЕРЯ СИГНАЛА. ПЕРЕПОДКЛЮЧЕНИЕ..."}
        </span>

        {/* Анимированные точки ожидания */}
        {status === "reconnecting" && (
          <span
            className="text-[10px] text-[var(--color-hit-red)]/60 tabular-nums"
            aria-hidden="true"
            style={{ animation: "morse-blink 1.2s step-end infinite" }}
          >
            ···
          </span>
        )}
      </div>

      {/* ── Кнопка форсированной синхронизации ────────────────────────── */}
      <button
        type="button"
        onClick={handleForceSync}
        disabled={isSyncing || !roomId}
        aria-label="Форсировать синхронизацию с сервером"
        className="
          shrink-0 rounded border px-3 py-1
          text-[9px] uppercase tracking-[0.2em]
          transition-all duration-150
          disabled:cursor-not-allowed
          disabled:border-[var(--color-ocean-800)]
          disabled:text-[var(--color-miss-white)]/20
          enabled:border-[var(--color-hit-red)]/50
          enabled:text-[var(--color-hit-red)]
          enabled:hover:bg-[var(--color-hit-red)]/10
          enabled:hover:border-[var(--color-hit-red)]
          focus-visible:outline-none
          focus-visible:ring-1
          focus-visible:ring-[var(--color-hit-red)]
        "
      >
        {isSyncing ? (
          <span style={{ animation: "morse-blink 0.5s step-end infinite" }} aria-hidden="true">
            SYNC...
          </span>
        ) : (
          "⇄ SYNC"
        )}
      </button>
    </div>
  );
}
