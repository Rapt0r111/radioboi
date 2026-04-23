// apps/web/app/game/[roomId]/page.tsx  ← ПРАВИЛЬНЫЙ ПУТЬ
//
// Динамический маршрут игровой сессии — React Server Component.
//
// ВАЖНО (Next.js 15+/16): `params` является Promise — await ОБЯЗАТЕЛЕН.
// playerId НЕ хранится в URL; генерируется на клиенте в GameClientWrapper.

import { GameClientWrapper } from "@/src/components/GameClientWrapper";

type GamePageProps = {
  params: Promise<{ roomId: string }>;
};

export default async function GamePage({ params }: GamePageProps) {
  // Next.js 15+/16: params — асинхронный объект, await обязателен.
  const { roomId } = await params;

  return <GameClientWrapper roomId={roomId} />;
}
