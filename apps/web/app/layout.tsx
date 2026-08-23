// Путь: /apps/web/app/layout.tsx
import type { Metadata } from "next";
import { AttributionWatermark } from "@/src/components/AttributionWatermark";
import { ATTRIBUTION_AUTHOR, ATTRIBUTION_ORG } from "@/src/lib/attribution";
import "./globals.css";

export const metadata: Metadata = {
  title: "Морской радиобой",
  description: "Реалтайм PvP-игра с азбукой Морзе",
  authors: [{ name: ATTRIBUTION_AUTHOR }],
  creator: ATTRIBUTION_AUTHOR,
  other: {
    "attribution-org": ATTRIBUTION_ORG,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning обязателен: globals.css устанавливает
    // color-scheme: dark на <html>, что браузер применяет до гидрации
    // и вызывает ложные React hydration mismatch предупреждения.
    <html lang="ru" suppressHydrationWarning data-scroll-behavior="smooth">
      <body>
        {/* 7 научная рота ВС РФ · Автор: Дудин А.А. */}
        <AttributionWatermark />
        {children}
      </body>
    </html>
  );
}
