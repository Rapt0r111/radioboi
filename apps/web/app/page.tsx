// apps/web/app/page.tsx
// Server lobby shell. The interactive room form stays in LobbyCreateForm.

import { LobbyCreateForm } from "@/src/components/LobbyCreateForm";

type LobbyProps = {
  searchParams: Promise<{ error?: string }>;
};

const STATUS_ITEMS = [
  { label: "MORSE LINK", value: "ГОТОВ" },
  { label: "NAVAL OPS", value: "ONLINE" },
  { label: "RADAR", value: "SCAN" },
] as const;

const FEATURE_CARDS = [
  {
    title: "Живой телеграф",
    text: "Координаты вводятся ключом Морзе, а звук реагирует сразу на нажатие.",
  },
  {
    title: "Морской бой",
    text: "Пуски ракет, попадания, промахи и потопления получают отдельные сигналы.",
  },
  {
    title: "Дуэль онлайн",
    text: "Пошаговый режим с перехватом или асинхронный обстрел после перезарядки.",
  },
] as const;

export default async function HomePage({ searchParams }: LobbyProps) {
  const { error } = await searchParams;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-ocean-950 px-4 py-5 text-miss-white sm:px-6 lg:px-8">
      <div
        aria-hidden="true"
        className="home-bg-gradient pointer-events-none absolute inset-0 opacity-80"
      />
      <div
        aria-hidden="true"
        className="home-bg-grid pointer-events-none absolute inset-0 opacity-[0.16]"
      />
      <div
        aria-hidden="true"
        className="home-radar-glow pointer-events-none absolute -left-28 top-20 h-136 w-136 rounded-full border border-radar-green/20 opacity-50"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-12 top-36 h-88 w-88 rounded-full border border-radar-green/15 opacity-60"
      />
      <div
        aria-hidden="true"
        className="home-bottom-scan pointer-events-none absolute bottom-0 left-0 right-0 h-40 opacity-35"
      />

      <section className="relative mx-auto grid min-h-[calc(100dvh-2.5rem)] w-full max-w-6xl items-center gap-7 lg:grid-cols-[1.12fr_0.88fr]">
        <div className="space-y-7">
          <div className="flex flex-wrap gap-2">
            {STATUS_ITEMS.map((item) => (
              <div
                key={item.label}
                className="rounded border border-radar-green/25 bg-ocean-900/60 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] shadow-[0_0_18px_rgba(0,255,136,0.05)] backdrop-blur"
              >
                <span className="text-miss-white/35">{item.label}</span>
                <span className="ml-2 text-radar-green">{item.value}</span>
              </div>
            ))}
          </div>

          <header className="max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.38em] text-morse-amber/70">
              частота 600 hz · callsign rb-01
            </p>
            <h1
              className="home-title-glow mt-4 font-mono text-4xl font-black uppercase leading-[0.95] tracking-[0.18em] text-radar-green sm:text-6xl lg:text-7xl"
            >
              Морской
              <span className="block text-miss-white">радиобой</span>
            </h1>
            <p className="mt-5 max-w-2xl font-mono text-sm leading-7 text-miss-white/62 sm:text-base">
              Радиорубка для PvP-морского боя: выбирайте сектор, передавайте координаты ключом Морзе,
              отражайте входящие ракеты и слушайте отдельные боевые сигналы каждого события.
            </p>
          </header>

          <div className="grid gap-3 sm:grid-cols-3">
            {FEATURE_CARDS.map((card) => (
              <article
                key={card.title}
                className="battle-panel rounded border border-radar-green/18 bg-ocean-900/45 p-4 shadow-[0_12px_34px_rgba(0,0,0,0.22)]"
              >
                <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-radar-green">{card.title}</h2>
                <p className="mt-3 text-xs leading-5 text-miss-white/48">{card.text}</p>
              </article>
            ))}
          </div>

          <div className="rounded border border-ocean-700/70 bg-ocean-950/60 p-4 font-mono text-[10px] uppercase tracking-[0.2em] text-miss-white/36 shadow-[0_0_38px_rgba(0,0,0,0.22)]">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="text-radar-green/80">▸ эфир чист</span>
              <span>• ракеты вооружены</span>
              <span>• бульк промаха активен</span>
              <span>• потопление подтверждается сиреной</span>
            </div>
          </div>
        </div>

        <aside className="battle-panel relative overflow-hidden rounded border border-radar-green/30 bg-ocean-950/82 p-4 shadow-[0_0_50px_rgba(0,255,136,0.1)] backdrop-blur sm:p-5">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-radar-green to-transparent opacity-70"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full border border-radar-green/15"
          />

          <div className="mb-5 flex items-center justify-between gap-3 border-b border-ocean-800/80 pb-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-radar-green/60">командный терминал</p>
              <h2 className="mt-1 font-mono text-lg font-bold uppercase tracking-[0.22em] text-miss-white">Вход в бой</h2>
            </div>
            <div className="flex gap-1.5" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-hit-red/75 shadow-[0_0_12px_rgba(255,61,61,0.55)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-morse-amber/75 shadow-[0_0_12px_rgba(255,170,0,0.5)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-radar-green/80 shadow-[0_0_12px_rgba(0,255,136,0.55)]" />
            </div>
          </div>

          <LobbyCreateForm {...(error ? { initialError: decodeURIComponent(error) } : {})} />
        </aside>
      </section>
    </main>
  );
}
