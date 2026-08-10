// apps/web/src/components/ConnectionMonitor.tsx
//
// Self WebSocket status only:
//   - transient loss → reconnect banner + force SYNC
//   - fatal close (ROOM_FULL / GAME_OVER) → permanent message + menu link
//
// Opponent offline UI lives in OpponentPresenceBanner.

"use client";

import { useEffect, useState } from "react";
import {
  type StatusBarLayout,
  TopStatusBar,
} from "@/src/components/TopStatusBar";
import {
  type ConnectionStatus,
  getGameClient,
} from "@/src/lib/network/gameClient";
import { useGameStore } from "@/src/store/gameStore";

type Props = {
  layout?: StatusBarLayout;
};

export function ConnectionMonitor({ layout = "fixed" }: Props) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [isSyncing, setIsSyncing] = useState(false);
  const [fatalReason, setFatalReason] = useState<string | null>(null);

  const playerId = useGameStore((s) => s.playerId);
  const playerName = useGameStore((s) => s.playerName);
  const roomId = useGameStore((s) => s.roomId);

  useEffect(() => {
    let client: ReturnType<typeof getGameClient>;
    try {
      client = getGameClient();
    } catch {
      return;
    }

    setStatus(client.status);
    setFatalReason(client.fatalReason);

    const unsubscribe = client.onStatusChange((next) => {
      setStatus(next);
      setFatalReason(client.fatalReason);
      if (next === "connected") {
        setIsSyncing(false);
        setFatalReason(null);
      }
    });

    return unsubscribe;
  }, []);

  function handleForceSync(): void {
    if (!roomId || !playerId || isSyncing) return;

    setIsSyncing(true);

    try {
      const client = getGameClient();
      if (client.status === "disconnected") {
        client.connect(roomId, playerId, playerName || "Player");
      } else {
        client.reconnect();
      }
    } catch (err) {
      console.error("[ConnectionMonitor] forceSync failed:", err);
      setIsSyncing(false);
    }
  }

  if (roomId === null) return null;

  if (status === "disconnected" && fatalReason !== null) {
    return (
      <TopStatusBar
        layout={layout}
        variant="danger"
        role="alert"
        live="assertive"
        label="Подключение отклонено"
        action={
          <a
            href="/"
            className="
              shrink-0 rounded border border-hit-red/50 px-3 py-1
              text-[9px] uppercase tracking-[0.2em] text-hit-red
              hover:bg-hit-red/10
            "
          >
            В МЕНЮ
          </a>
        }
      >
        {fatalReason}
      </TopStatusBar>
    );
  }

  if (status !== "disconnected" && status !== "reconnecting") return null;

  return (
    <TopStatusBar
      layout={layout}
      variant="danger"
      role="status"
      live="assertive"
      label="Статус соединения"
      action={
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
            disabled:border-ocean-800
            disabled:text-miss-white/20
            enabled:border-hit-red/50
            enabled:text-hit-red
            enabled:hover:bg-hit-red/10
            enabled:hover:border-hit-red
            focus-visible:outline-none
            focus-visible:ring-1
            focus-visible:ring-hit-red
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
      }
    >
      {status === "reconnecting" ? "ПЕРЕПОДКЛЮЧЕНИЕ..." : "ПОТЕРЯ СИГНАЛА. ПЕРЕПОДКЛЮЧЕНИЕ..."}
    </TopStatusBar>
  );
}
