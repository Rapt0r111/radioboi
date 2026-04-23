// apps/web/src/app/game/[roomId]/loading.tsx
// Next.js автоматически показывает этот компонент во время загрузки RSC / Client.
// Стилизован под CRT-терминал с мигающим курсором.

export default function GameLoading() {
  return (
    <div
      className="
        crt-scanlines
        flex min-h-dvh flex-col items-center justify-center gap-6
        bg-[var(--color-ocean-950)] px-4
      "
      role="status"
      aria-label="Загрузка игровой сессии"
    >
      {/* ── Рамка терминала ─────────────────────────────────────────────── */}
      <div
        className="
          w-full max-w-lg rounded border border-[var(--color-radar-green)]/40
          bg-[var(--color-ocean-900)] p-8
          radar-glow
        "
      >
        {/* Строка заголовка терминала */}
        <div className="mb-6 flex items-center gap-2 border-b border-[var(--color-radar-green)]/20 pb-3">
          <span className="h-2 w-2 rounded-full bg-[var(--color-hit-red)]" aria-hidden="true" />
          <span className="h-2 w-2 rounded-full bg-[var(--color-morse-amber)]" aria-hidden="true" />
          <span className="h-2 w-2 rounded-full bg-[var(--color-radar-green)]" aria-hidden="true" />
          <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-miss-white)]/30">
            SECURE CHANNEL · RADIOBOI v0.1
          </span>
        </div>

        {/* Основной текст */}
        <div className="space-y-3 font-mono text-sm leading-relaxed">
          <p className="text-[var(--color-radar-green)]/70">
            <span className="text-[var(--color-radar-green)]">$</span>{" "}
            init --session secure
          </p>
          <p className="text-[var(--color-miss-white)]/80">
            ▸ УСТАНОВКА СЕКРЕТНОГО СОЕДИНЕНИЯ...
          </p>
          <p className="text-[var(--color-miss-white)]/60">
            ▸ СИНХРОНИЗАЦИЯ ПРОТОКОЛА МОРЗЕ...
          </p>
          <p className="text-[var(--color-miss-white)]/40">
            ▸ ЗАГРУЗКА ИГРОВЫХ КОМПОНЕНТОВ...
          </p>

          {/* Строка ожидания с мигающим курсором (CSS-анимация) */}
          <p className="mt-6 text-[var(--color-radar-green)] uppercase tracking-widest">
            ПОЖАЛУЙСТА, ЖДИТЕ
            <span
              className="ml-1 inline-block"
              style={{ animation: "morse-blink 1s step-end infinite" }}
              aria-hidden="true"
            >
              ▌
            </span>
          </p>
        </div>
      </div>

      {/* ── Статус-строка под рамкой ─────────────────────────────────────── */}
      <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-miss-white)]/20">
        RADIOBOI · CLOUDFLARE EDGE NETWORK
      </p>
    </div>
  );
}