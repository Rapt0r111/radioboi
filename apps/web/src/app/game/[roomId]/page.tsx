// apps/web/src/app/game/[roomId]/page.tsx
// Динамический маршрут игровой сессии — React Server Component.
//
// ВАЖНО (Next.js 16): `params` является Promise — await ОБЯЗАТЕЛЕН.
// playerId НЕ передаётся через URL; он генерируется на клиенте в GameClientWrapper.

import { GameClientWrapper } from "@/src/components/GameClientWrapper";

type GamePageProps = {
  params: Promise<{ roomId: string }>;
};

export default async function GamePage({ params }: GamePageProps) {
  // Next.js 16: params — асинхронный объект, await обязателен.
  const { roomId } = await params;

  return <GameClientWrapper roomId={roomId} />;
}