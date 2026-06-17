// apps/web/src/components/GameOverScreen.tsx
"use client";

import {
  BOARD_COLUMN_LABELS,
  BOARD_ROW_LABELS,
  type Board,
  type CellState,
  COLUMNS,
  type Coordinate,
  ROWS,
} from "@radioboi/game-core";
import { useMemo } from "react";
import {
  selectEnemyBoard,
  selectOwnBoard,
  selectSettings,
  selectShotLog,
  selectWinnerId,
  type ShotLogEntry,
  useGameStore,
} from "@/src/store/gameStore";

type Props = {
  roomId: string;
};

type Outcome = "win" | "loss" | "draw";

type SideStats = {
  shots: number;
  hits: number;
  misses: number;
  sunk: number;
  accuracy: number;
  longestHitStreak: number;
};

type BoardStats = {
  activeShips: number;
  damagedCells: number;
  sunkCells: number;
  missedCells: number;
  blockedCells: number;
};

const OUTCOME_COPY: Record<
  Outcome,
  {
    eyebrow: string;
    headline: string;
    symbol: string;
    summary: string;
    accent: string;
    border: string;
    glow: string;
  }
> = {
  win: {
    eyebrow: "Бой завершён",
    headline: "Победа",
    symbol: "▲",
    summary: "Вражеский флот уничтожен. Канал очищен.",
    accent: "text-radar-green",
    border: "border-radar-green/45",
    glow: "shadow-[0_0_44px_rgba(0,255,136,0.12)]",
  },
  loss: {
    eyebrow: "Бой завершён",
    headline: "Поражение",
    symbol: "×",
    summary: "Ваш флот потерян. Сводка показывает слабые места обороны.",
    accent: "text-hit-red",
    border: "border-hit-red/45",
    glow: "shadow-[0_0_44px_rgba(255,59,59,0.12)]",
  },
  draw: {
    eyebrow: "Сигнал оборван",
    headline: "Ничья",
    symbol: "≈",
    summary: "Игра завершена без победителя. Данные боя сохранены в отчёте.",
    accent: "text-morse-amber",
    border: "border-morse-amber/45",
    glow: "shadow-[0_0_44px_rgba(255,170,0,0.12)]",
  },
};

function getOutcome(winnerId: string | null, playerId: string | null): Outcome {
  if (winnerId === null) return "draw";
  return winnerId === playerId ? "win" : "loss";
}

function calculateSideStats(shotLog: ShotLogEntry[], by: ShotLogEntry["by"]): SideStats {
  const shots = shotLog.filter((entry) => entry.by === by);
  const hits = shots.filter((entry) => entry.result !== "miss").length;
  const misses = shots.length - hits;
  const sunk = shots.filter((entry) => entry.result === "sunk").length;

  let currentStreak = 0;
  let longestHitStreak = 0;
  for (const shot of shots) {
    if (shot.result === "miss") {
      currentStreak = 0;
      continue;
    }

    currentStreak += 1;
    longestHitStreak = Math.max(longestHitStreak, currentStreak);
  }

  return {
    shots: shots.length,
    hits,
    misses,
    sunk,
    accuracy: shots.length === 0 ? 0 : Math.round((hits / shots.length) * 100),
    longestHitStreak,
  };
}

function calculateBoardStats(board: Board): BoardStats {
  const stats: BoardStats = {
    activeShips: 0,
    damagedCells: 0,
    sunkCells: 0,
    missedCells: 0,
    blockedCells: 0,
  };

  for (const cell of Object.values(board)) {
    switch (cell) {
      case "ship":
        stats.activeShips += 1;
        break;
      case "hit":
        stats.damagedCells += 1;
        break;
      case "sunk":
        stats.sunkCells += 1;
        break;
      case "miss":
        stats.missedCells += 1;
        break;
      case "blocked":
        stats.blockedCells += 1;
        break;
      default:
        break;
    }
  }

  return stats;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "менее минуты";

  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds} сек`;
  return `${minutes} мин ${seconds.toString().padStart(2, "0")} сек`;
}

function formatPercent(value: number): string {
  return `${value}%`;
}

function resultLabel(result: ShotLogEntry["result"]): string {
  switch (result) {
    case "hit":
      return "Попадание";
    case "sunk":
      return "Потоплен";
    case "miss":
      return "Мимо";
  }
}

function resultClass(result: ShotLogEntry["result"]): string {
  switch (result) {
    case "hit":
      return "border-morse-amber/35 bg-morse-amber/8 text-morse-amber";
    case "sunk":
      return "border-hit-red/40 bg-hit-red/8 text-hit-red";
    case "miss":
      return "border-miss-white/12 bg-miss-white/4 text-miss-white/45";
  }
}

function cellClass(state: CellState | undefined, revealShips: boolean): string {
  const base = "block h-3 w-3 rounded-[2px] border";

  switch (state) {
    case "ship":
      return revealShips
        ? `${base} border-radar-green/34 bg-radar-green/18`
        : `${base} border-ocean-800/65 bg-ocean-950/70`;
    case "hit":
      return `${base} border-hit-red/60 bg-hit-red/28 shadow-[0_0_8px_rgba(255,59,59,0.2)]`;
    case "sunk":
      return `${base} border-hit-red bg-hit-red/55 shadow-[0_0_10px_rgba(255,59,59,0.3)]`;
    case "miss":
      return `${base} border-miss-white/24 bg-miss-white/8`;
    case "blocked":
      return `${base} border-miss-white/10 bg-miss-white/4`;
    default:
      return `${base} border-ocean-800/65 bg-ocean-950/70`;
  }
}

function buildBattleSpan(shotLog: ShotLogEntry[]): number {
  if (shotLog.length < 2) return 0;

  const firstTs = shotLog[0]?.ts ?? 0;
  const lastTs = shotLog.at(-1)?.ts ?? firstTs;
  return Math.max(0, lastTs - firstTs);
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "good" | "danger" | "warn" | "neutral";
}) {
  const valueClass =
    tone === "good"
      ? "text-radar-green"
      : tone === "danger"
        ? "text-hit-red"
        : tone === "warn"
          ? "text-morse-amber"
          : "text-miss-white";

  return (
    <div className="rounded border border-ocean-800/70 bg-ocean-950/56 px-4 py-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-miss-white/35">
        {label}
      </p>
      <p className={`mt-2 font-mono text-2xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      <p className="mt-1 font-mono text-[10px] leading-4 text-miss-white/38">{detail}</p>
    </div>
  );
}

function StatLine({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "good" | "danger" | "warn" | "neutral";
}) {
  const valueClass =
    tone === "good"
      ? "text-radar-green"
      : tone === "danger"
        ? "text-hit-red"
        : tone === "warn"
          ? "text-morse-amber"
          : "text-miss-white/78";

  return (
    <div className="flex items-center justify-between gap-4 border-b border-ocean-800/45 py-2 last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-miss-white/38">
        {label}
      </span>
      <span className={`font-mono text-sm font-bold tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

function SectionHeader({ label, value }: { label: string; value?: string }) {
  return (
    <header className="mb-4 flex items-center gap-3 border-b border-ocean-800/60 pb-3">
      <span className="h-1.5 w-1.5 rounded-full bg-radar-green/70 shadow-[0_0_10px_rgba(0,255,136,0.45)]" />
      <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-miss-white/58">
        {label}
      </h2>
      {value !== undefined ? (
        <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.18em] text-radar-green/48">
          {value}
        </span>
      ) : null}
    </header>
  );
}

function StatsPanel({
  title,
  stats,
  boardStats,
  variant,
}: {
  title: string;
  stats: SideStats;
  boardStats: BoardStats;
  variant: "attack" | "defense";
}) {
  const isAttack = variant === "attack";

  return (
    <section className="battle-panel rounded border p-4">
      <SectionHeader label={title} value={isAttack ? "ваш огонь" : "оборона"} />
      <div className="space-y-1">
        <StatLine label="Выстрелы" value={stats.shots} />
        <StatLine label="Попадания" value={stats.hits} tone={isAttack ? "good" : "danger"} />
        <StatLine label="Промахи" value={stats.misses} />
        <StatLine label="Точность" value={formatPercent(stats.accuracy)} tone={isAttack ? "good" : "warn"} />
        <StatLine label="Потопления" value={stats.sunk} tone={isAttack ? "danger" : "warn"} />
        <StatLine label="Лучшая серия" value={stats.longestHitStreak} tone="warn" />
      </div>

      <div className="mt-5 rounded border border-ocean-800/65 bg-ocean-950/45 px-3 py-2">
        <div className="grid grid-cols-2 gap-x-5 gap-y-2">
          <StatLine label={isAttack ? "Открыто клеток" : "Попали по нам"} value={isAttack ? boardStats.damagedCells + boardStats.sunkCells + boardStats.missedCells : boardStats.damagedCells + boardStats.sunkCells} tone={isAttack ? "good" : "danger"} />
          <StatLine label={isAttack ? "Зоны вокруг" : "Живые палубы"} value={isAttack ? boardStats.blockedCells : boardStats.activeShips} tone={isAttack ? "neutral" : "good"} />
        </div>
      </div>
    </section>
  );
}

function OverallStatsPanel({
  totalShots,
  totalHits,
  totalMisses,
  totalSunk,
  totalAccuracy,
  revealedCells,
  battleTempo,
  duration,
}: {
  totalShots: number;
  totalHits: number;
  totalMisses: number;
  totalSunk: number;
  totalAccuracy: number;
  revealedCells: number;
  battleTempo: string;
  duration: number;
}) {
  return (
    <section className="battle-panel rounded border p-4">
      <SectionHeader label="Общая статистика" value="вся партия" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Все выстрелы"
          value={String(totalShots)}
          detail={`${totalHits} попаданий, ${totalMisses} промахов`}
          tone="neutral"
        />
        <MetricCard
          label="Общая точность"
          value={formatPercent(totalAccuracy)}
          detail="Попадания обеих сторон от общего числа залпов"
          tone="warn"
        />
        <MetricCard
          label="Потопления"
          value={String(totalSunk)}
          detail="Суммарно по журналу боя"
          tone="danger"
        />
        <MetricCard
          label="Раскрыто клеток"
          value={String(revealedCells)}
          detail="Попадания, промахи, потопления и зоны вокруг"
          tone="good"
        />
      </div>
      <div className="mt-4 grid gap-3 rounded border border-ocean-800/60 bg-ocean-950/44 p-3 sm:grid-cols-3">
        <StatLine label="Темп" value={battleTempo} tone="warn" />
        <StatLine label="Длительность" value={formatDuration(duration)} />
        <StatLine label="Итоговый урон" value={totalHits} tone="danger" />
      </div>
    </section>
  );
}

function MiniBoard({
  title,
  board,
  revealShips,
}: {
  title: string;
  board: Board;
  revealShips: boolean;
}) {
  return (
    <div className="rounded border border-ocean-800/70 bg-ocean-950/48 p-3">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-miss-white/45">
        {title}
      </p>
      <table className="border-separate border-spacing-0.5" aria-label={title}>
        <thead>
          <tr>
            <th className="h-3 w-3" />
            {COLUMNS.map((col, colIndex) => (
              <th
                key={col}
                className="h-3 w-3 text-center font-mono text-[7px] leading-none text-miss-white/24"
              >
                {BOARD_COLUMN_LABELS[colIndex] ?? colIndex + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row, rowIndex) => (
            <tr key={row}>
              <th className="h-3 w-3 text-center font-mono text-[7px] leading-none text-miss-white/24">
                {BOARD_ROW_LABELS[rowIndex] ?? rowIndex + 1}
              </th>
              {COLUMNS.map((col) => {
                const coord = `${col}${row}` as Coordinate;
                const state = board[coord];

                return (
                  <td key={coord} className="p-0">
                    <span
                      className={cellClass(state, revealShips)}
                      title={`${coord}: ${state ?? "empty"}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShotTimeline({ shotLog }: { shotLog: ShotLogEntry[] }) {
  const shots = shotLog.slice().reverse();

  return (
    <section className="battle-panel rounded border p-4">
      <SectionHeader label="История сигналов" value={`${shotLog.length} всего`} />
      {shots.length === 0 ? (
        <p className="rounded border border-ocean-800/60 bg-ocean-950/45 px-3 py-4 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-miss-white/28">
          Журнал боя пуст
        </p>
      ) : (
        <div className="max-h-120 space-y-2 overflow-y-auto pr-1">
          {shots.map((entry, index) => {
            const absoluteIndex = shotLog.length - index;
            const isUs = entry.by === "us";

            return (
              <div
                key={`${entry.ts}-${entry.by}-${entry.coord}-${entry.result}-${absoluteIndex}`}
                data-testid="shot-timeline-row"
                className="flex items-center gap-3 rounded border border-ocean-800/55 bg-ocean-950/46 px-3 py-2"
              >
                <span className="w-6 text-right font-mono text-[10px] tabular-nums text-miss-white/25">
                  {absoluteIndex}
                </span>
                <span className={isUs ? "font-mono text-[10px] uppercase tracking-[0.18em] text-radar-green/70" : "font-mono text-[10px] uppercase tracking-[0.18em] text-hit-red/70"}>
                  {isUs ? "Мы" : "Они"}
                </span>
                <span className="min-w-12 font-mono text-sm font-bold tabular-nums text-miss-white/78">
                  {entry.coord}
                </span>
                <span
                  className={`ml-auto rounded border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] ${resultClass(entry.result)}`}
                >
                  {resultLabel(entry.result)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function GameOverScreen({ roomId }: Props) {
  const playerId = useGameStore((s) => s.playerId);
  const winnerId = useGameStore(selectWinnerId);
  const shotLog = useGameStore(selectShotLog);
  const ownBoard = useGameStore(selectOwnBoard);
  const enemyBoard = useGameStore(selectEnemyBoard);
  const settings = useGameStore(selectSettings);

  const report = useMemo(() => {
    const outcome = getOutcome(winnerId, playerId);
    const ownFire = calculateSideStats(shotLog, "us");
    const enemyFire = calculateSideStats(shotLog, "them");
    const ownBoardStats = calculateBoardStats(ownBoard);
    const enemyBoardStats = calculateBoardStats(enemyBoard);
    const duration = buildBattleSpan(shotLog);
    const totalHits = ownFire.hits + enemyFire.hits;
    const totalShots = shotLog.length;
    const totalMisses = ownFire.misses + enemyFire.misses;
    const totalSunk = ownFire.sunk + enemyFire.sunk;
    const totalAccuracy = totalShots === 0 ? 0 : Math.round((totalHits / totalShots) * 100);
    const revealedCells =
      ownBoardStats.damagedCells +
      ownBoardStats.sunkCells +
      ownBoardStats.missedCells +
      ownBoardStats.blockedCells +
      enemyBoardStats.damagedCells +
      enemyBoardStats.sunkCells +
      enemyBoardStats.missedCells +
      enemyBoardStats.blockedCells;
    const tempo =
      duration <= 0
        ? "нет данных"
        : `${Math.round((totalShots / Math.max(1, duration / 60_000)) * 10) / 10}/мин`;

    return {
      outcome,
      ownFire,
      enemyFire,
      ownBoardStats,
      enemyBoardStats,
      duration,
      totalHits,
      totalShots,
      totalMisses,
      totalSunk,
      totalAccuracy,
      revealedCells,
      tempo,
    };
  }, [enemyBoard, ownBoard, playerId, shotLog, winnerId]);

  const copy = OUTCOME_COPY[report.outcome];
  const modeLabel = settings.battleMode === "async" ? "Асинхронный бой" : "Ходовой бой";
  const damageDelta = report.ownFire.hits - report.enemyFire.hits;
  const accuracyDelta = report.ownFire.accuracy - report.enemyFire.accuracy;

  return (
    <main className="battle-shell min-h-dvh px-4 py-5 text-miss-white sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <section className={`battle-panel rounded border p-5 sm:p-6 ${copy.border} ${copy.glow}`}>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className={`font-mono text-[10px] uppercase tracking-[0.32em] ${copy.accent}`}>
                {copy.eyebrow}
              </p>
              <div className="mt-3 flex items-center gap-4">
                <span className={`font-mono text-5xl font-black leading-none ${copy.accent}`} aria-hidden="true">
                  {copy.symbol}
                </span>
                <div>
                  <h1 className={`font-mono text-4xl font-black uppercase tracking-[0.18em] sm:text-5xl ${copy.accent}`}>
                    {copy.headline}
                  </h1>
                  <p className="mt-2 max-w-2xl font-mono text-xs leading-5 text-miss-white/48">
                    {copy.summary}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid min-w-64 grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-miss-white/38">
              <div className="rounded border border-ocean-800/70 bg-ocean-950/50 px-3 py-2">
                <span className="block text-miss-white/25">Комната</span>
                <span className="mt-1 block text-radar-green/70">{roomId}</span>
              </div>
              <div className="rounded border border-ocean-800/70 bg-ocean-950/50 px-3 py-2">
                <span className="block text-miss-white/25">Режим</span>
                <span className="mt-1 block text-morse-amber/70">{modeLabel}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Длительность"
            value={formatDuration(report.duration)}
            detail="От первого до последнего подтверждённого выстрела"
            tone="neutral"
          />
          <MetricCard
            label="Разница урона"
            value={damageDelta > 0 ? `+${damageDelta}` : String(damageDelta)}
            detail="Ваши попадания минус попадания противника"
            tone={damageDelta > 0 ? "good" : damageDelta < 0 ? "danger" : "warn"}
          />
          <MetricCard
            label="Точность"
            value={formatPercent(report.ownFire.accuracy)}
            detail={`Противник: ${formatPercent(report.enemyFire.accuracy)}`}
            tone={accuracyDelta >= 0 ? "good" : "danger"}
          />
          <MetricCard
            label="Темп боя"
            value={report.tempo}
            detail={`${shotLog.length} выстрелов, ${report.totalHits} попаданий`}
            tone="warn"
          />
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.1fr)_minmax(0,0.95fr)]">
          <StatsPanel
            title="Огонь по противнику"
            stats={report.ownFire}
            boardStats={report.enemyBoardStats}
            variant="attack"
          />

          <section className="battle-panel rounded border p-4">
            <SectionHeader label="Финальная карта боя" value="100 клеток" />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <MiniBoard title="Поле противника" board={enemyBoard} revealShips={false} />
              <MiniBoard title="Ваш флот" board={ownBoard} revealShips />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded border border-ocean-800/60 bg-ocean-950/44 p-3 sm:grid-cols-4">
              <StatLine label="Ваши целые" value={report.ownBoardStats.activeShips} tone="good" />
              <StatLine label="Ваши пробоины" value={report.ownBoardStats.damagedCells} tone="danger" />
              <StatLine label="Враг потоплен" value={report.ownFire.sunk} tone="danger" />
              <StatLine label="Зоны вскрыты" value={report.enemyBoardStats.blockedCells} />
            </div>
          </section>

          <StatsPanel
            title="Огонь противника"
            stats={report.enemyFire}
            boardStats={report.ownBoardStats}
            variant="defense"
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-5">
            <OverallStatsPanel
              totalShots={report.totalShots}
              totalHits={report.totalHits}
              totalMisses={report.totalMisses}
              totalSunk={report.totalSunk}
              totalAccuracy={report.totalAccuracy}
              revealedCells={report.revealedCells}
              battleTempo={report.tempo}
              duration={report.duration}
            />
            <ShotTimeline shotLog={shotLog} />
          </div>

          <aside className="battle-panel rounded border p-4">
            <SectionHeader label="Вывод штаба" />
            <div className="space-y-3 font-mono text-xs leading-5 text-miss-white/52">
              <p>
                {report.outcome === "win"
                  ? "Преимущество удержано за счёт точного огня и давления по кораблям противника."
                  : report.outcome === "loss"
                    ? "Критический разрыв появился в обороне. Проверьте клетки с серией попаданий противника."
                    : "Баланс огня почти равный. Следующий бой решит точность первых залпов."}
              </p>
              <div className="rounded border border-ocean-800/60 bg-ocean-950/45 p-3">
                <StatLine label="Перевес точности" value={accuracyDelta > 0 ? `+${accuracyDelta}%` : `${accuracyDelta}%`} tone={accuracyDelta >= 0 ? "good" : "danger"} />
                <StatLine label="Перевес залпов" value={report.ownFire.shots - report.enemyFire.shots} tone="warn" />
                <StatLine label="Принято ударов" value={report.enemyFire.hits} tone="danger" />
              </div>
            </div>

            <a
              href="/"
              className="mt-5 flex w-full cursor-pointer items-center justify-center rounded border border-radar-green/70 px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.18em] text-radar-green transition-colors duration-150 hover:bg-radar-green hover:text-ocean-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-radar-green"
            >
              Новый бой
            </a>
          </aside>
        </div>
      </div>
    </main>
  );
}
