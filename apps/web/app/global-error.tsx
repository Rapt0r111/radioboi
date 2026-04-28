// apps/web/app/global-error.tsx
// Корневой error boundary — ловит ошибки из layout.tsx и его дочерних компонентов.
// Отображается вместо всей страницы, поэтому должен сам рендерить <html><body>.
// Документация: https://nextjs.org/docs/app/building-your-application/routing/error-handling#handling-global-errors
"use client";

import { useEffect } from "react";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          backgroundColor: "#020d1a",
          color: "#e0e8f0",
          fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "480px",
            borderRadius: "6px",
            border: "1px solid rgba(255,59,59,0.4)",
            background: "rgba(4,21,40,0.9)",
            padding: "2rem",
          }}
        >
          {/* Заголовок терминала */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              borderBottom: "1px solid rgba(255,59,59,0.2)",
              paddingBottom: "12px",
              marginBottom: "20px",
            }}
          >
            <span
              style={{
                height: "6px",
                width: "6px",
                borderRadius: "50%",
                background: "#ff3b3b",
                display: "inline-block",
              }}
            />
            <span
              style={{
                fontFamily: "inherit",
                fontSize: "9px",
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                color: "rgba(224,232,240,0.3)",
              }}
            >
              CRITICAL SYSTEM ERROR
            </span>
          </div>

          {/* Сообщение */}
          <div style={{ marginBottom: "24px" }}>
            <p
              style={{
                color: "#ff3b3b",
                fontFamily: "inherit",
                fontSize: "13px",
                fontWeight: "bold",
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                marginBottom: "8px",
              }}
            >
              ✕ Критическая ошибка приложения
            </p>
            <p
              style={{
                color: "rgba(224,232,240,0.5)",
                fontFamily: "inherit",
                fontSize: "11px",
              }}
            >
              {error.message ?? "Неизвестная ошибка"}
            </p>
            {error.digest && (
              <p
                style={{
                  color: "rgba(224,232,240,0.2)",
                  fontFamily: "inherit",
                  fontSize: "9px",
                  marginTop: "6px",
                }}
              >
                digest: {error.digest}
              </p>
            )}
          </div>

          {/* Кнопки */}
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                flex: 1,
                borderRadius: "4px",
                border: "1px solid #00ff88",
                background: "transparent",
                padding: "8px 16px",
                fontFamily: "inherit",
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                color: "#00ff88",
                cursor: "pointer",
              }}
            >
              [ Перезагрузить ]
            </button>
            <a
              href="/"
              style={{
                flex: 1,
                borderRadius: "4px",
                border: "1px solid rgba(6,32,64,1)",
                padding: "8px 16px",
                fontFamily: "inherit",
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                color: "rgba(224,232,240,0.4)",
                cursor: "pointer",
                textDecoration: "none",
                textAlign: "center",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              [ Лобби ]
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}