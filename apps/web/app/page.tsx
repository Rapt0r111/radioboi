// apps/web/app/page.tsx
//
// Лобби — React Server Component.
// Интерактивная форма (настройки, toggle) вынесена в LobbyCreateForm (client).

import { LobbyCreateForm } from "@/src/components/LobbyCreateForm";

type LobbyProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function HomePage({ searchParams }: LobbyProps) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-12 px-4">
      {/* ── Заголовок ──────────────────────────────────────────────────────── */}
      <header className="text-center">
        <h1 className="font-mono text-4xl font-bold tracking-widest text-radar-green morse-glow">
          ▸ МОРСКОЙ РАДИОБОЙ
        </h1>
        <p className="mt-2 text-sm text-miss-white/50">
          РЕАЛТАЙМ PvP · АЗБУКА МОРЗЕ · CLOUDFLARE
        </p>
      </header>

      {/* ── Форма (client component) ────────────────────────────────────────── */}
      <LobbyCreateForm initialError={error ? decodeURIComponent(error) : undefined} />

      {/* ── Футер ──────────────────────────────────────────────────────────── */}
      <footer className="font-mono text-[10px] text-miss-white/20">
        RADIOBOI · CLOUDFLARE WORKERS · KV · DURABLE OBJECTS
      </footer>
    </main>
  );
}