// apps/web/src/components/OpponentPresenceBanner.tsx
// Shows opponent offline state + remaining reconnect budget countdown.

"use client";

import {
  type StatusBarLayout,
  TopStatusBar,
} from "@/src/components/TopStatusBar";
import { useNow } from "@/src/hooks/useNow";
import { selectOpponentSummary, useGameStore } from "@/src/store/gameStore";

type Props = {
  layout?: StatusBarLayout;
};

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function OpponentPresenceBanner({ layout = "fixed" }: Props) {
  const opponent = useGameStore(selectOpponentSummary);
  const offline = opponent !== null && opponent.connected === false;
  const now = useNow(offline);

  if (!offline || opponent === null) return null;

  const deadline = opponent.reconnectDeadlineAt;
  const secondsLeft =
    deadline !== null ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  const label =
    secondsLeft !== null
      ? `Соперник офлайн · перезаход ${formatCountdown(secondsLeft)}`
      : "Соперник офлайн";

  return (
    <TopStatusBar
      layout={layout}
      variant="warn"
      role="status"
      live="polite"
      label="Соперник офлайн"
    >
      {label}
    </TopStatusBar>
  );
}
