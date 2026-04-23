// apps/web/app/page.tsx  ← ПРАВИЛЬНЫЙ ПУТЬ: заменяет заглушку Фазы 0
//
// Лобби — React Server Component.
// Использует нативный form action={...} для Server Actions без клиентского JS.

import { redirect } from "next/navigation";
import { createRoomAction, joinRoomAction } from "./actions";

// searchParams нужен для отображения ошибки после неудачного join (без JS).
type LobbyProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function HomePage({ searchParams }: LobbyProps) {
  const { error } = await searchParams;

  // ── Server Action: создать комнату ──────────────────────────────────────────
  async function handleCreate() {
    "use server";
    const roomId = await createRoomAction();
    redirect(`/game/${roomId}`);
  }

  // ── Server Action: войти в комнату ──────────────────────────────────────────
  async function handleJoin(formData: FormData) {
    "use server";
    const raw = formData.get("code");
    const code = typeof raw === "string" ? raw : "";
    const result = await joinRoomAction(code);
    if ("success" in result && result.success) {
      redirect(`/game/${result.roomId}`);
    } else {
      const msg = "error" in result ? result.error : "Unknown error";
      redirect(`/?error=${encodeURIComponent(msg)}`);
    }
  }

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

      {/* ── Панель действий ────────────────────────────────────────────────── */}
      <div className="flex w-full max-w-sm flex-col gap-6">
        {/* Создать комнату */}
        <form action={handleCreate}>
          <button
            type="submit"
            className="
              w-full rounded border border-radar-green
              px-6 py-3 font-mono text-sm font-bold
              text-radar-green uppercase tracking-widest
              transition-colors duration-150
              hover:bg-radar-green hover:text-ocean-950
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-radar-green
              radar-glow
            "
          >
            [ СОЗДАТЬ КОМНАТУ ]
          </button>
        </form>

        {/* Разделитель */}
        <div className="flex items-center gap-3 text-miss-white/30">
          <div className="h-px flex-1 bg-current" />
          <span className="font-mono text-xs uppercase">или</span>
          <div className="h-px flex-1 bg-current" />
        </div>

        {/* Войти в комнату по коду */}
        <form action={handleJoin} className="flex flex-col gap-3">
          <label
            htmlFor="room-code"
            className="font-mono text-xs uppercase tracking-widest text-miss-white/60"
          >
            Код комнаты (6 символов)
          </label>
          <input
            id="room-code"
            name="code"
            type="text"
            placeholder="A7K9P2"
            maxLength={6}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            className="
              rounded border border-ocean-800
              bg-ocean-900 px-4 py-3
              font-mono text-lg font-bold tracking-[0.35em] uppercase
              text-miss-white placeholder-miss-white/20
              outline-none transition-colors duration-150
              focus:border-radar-dim
              focus-visible:ring-2 focus-visible:ring-radar-green
            "
          />
          <button
            type="submit"
            className="
              rounded border border-morse-amber
              px-6 py-3 font-mono text-sm font-bold
              text-morse-amber uppercase tracking-widest
              transition-colors duration-150
              hover:bg-morse-amber hover:text-ocean-950
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-morse-amber
            "
          >
            [ ВОЙТИ В КОМНАТУ ]
          </button>

          {/* Ошибка входа (без JS — через searchParam) */}
          {error && (
            <p
              role="alert"
              className="font-mono text-xs text-hit-red uppercase tracking-widest"
            >
              ✕ {decodeURIComponent(error)}
            </p>
          )}
        </form>
      </div>

      {/* ── Футер ──────────────────────────────────────────────────────────── */}
      <footer className="font-mono text-[10px] text-miss-white/20">
        RADIOBOI · CLOUDFLARE WORKERS · KV · DURABLE OBJECTS
      </footer>
    </main>
  );
}
