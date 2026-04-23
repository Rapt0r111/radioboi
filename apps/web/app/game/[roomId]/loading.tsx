// apps/web/app/game/[roomId]/loading.tsx  ← ПРАВИЛЬНЫЙ ПУТЬ
//
// Next.js автоматически показывает этот компонент во время загрузки RSC / Client.
// Стилизован под CRT-терминал с мигающим курсором.
// Анимация morse-blink объявлена в app/globals.css — никакого нового CSS.

export default function GameLoading() {
  return (
    <div
      className="
        crt-scanlines
        flex min-h-dvh flex-col items-center justify-center gap-6
        bg-ocean-950 px-4
      "
      role="status"
      aria-label="Загрузка игровой сессии"
    >
      {/* ── Рамка терминала ─────────────────────────────────────────────── */}
      <div
        className="
          w-full max-w-lg rounded border border-radar-green/40
          bg-ocean-900 p-8
          radar-glow
        "
      >
        {/* Строка заголовка терминала */}
        <div className="mb-6 flex items-center gap-2 border-b border-radar-green/20 pb-3">
          <span className="h-2 w-2 rounded-full bg-hit-red" aria-hidden="true" />
          <span className="h-2 w-2 rounded-full bg-morse-amber" aria-hidden="true" />
          <span className="h-2 w-2 rounded-full bg-radar-green" aria-hidden="true" />
          <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-miss-white/30">
            SECURE CHANNEL · RADIOBOI v0.1
          </span>
        </div>

        {/* Основной текст */}
        <div className="space-y-3 font-mono text-sm leading-relaxed">
          <p className="text-radar-green/70">
            <span className="text-radar-green">$</span> init --session secure
          </p>
          <p className="text-miss-white/80">▸ УСТАНОВКА СЕКРЕТНОГО СОЕДИНЕНИЯ...</p>
          <p className="text-miss-white/60">▸ СИНХРОНИЗАЦИЯ ПРОТОКОЛА МОРЗЕ...</p>
          <p className="text-miss-white/40">▸ ЗАГРУЗКА ИГРОВЫХ КОМПОНЕНТОВ...</p>

          {/* Мигающий курсор — через keyframe morse-blink из globals.css */}
          <p className="mt-6 text-radar-green uppercase tracking-widest">
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

      {/* ── Статус-строка ────────────────────────────────────────────────── */}
      <p className="font-mono text-[10px] uppercase tracking-widest text-miss-white/20">
        RADIOBOI · CLOUDFLARE EDGE NETWORK
      </p>
    </div>
  );
}
