// Путь: /apps/web/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title:       "Морской радиобой",
  description: "Реалтайм PvP-игра с азбукой Морзе",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning обязателен: globals.css устанавливает
    // color-scheme: dark на <html>, что браузер применяет до гидрации
    // и вызывает ложные React hydration mismatch предупреждения.
    <html lang="ru" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}