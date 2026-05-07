// apps/worker/src/types.ts
// Shared bindings — импортируется и index.ts, и GameRoomArbitrator.ts.
//
// FIX: DurableObjectNamespace типизирован с классом GameRoomArbitrator.
// При `extends DurableObject<Env>` платформа требует явной типизации namespace
// чтобы RPC-методы были доступны через stub (type safety для DO вызовов).
// Используем forward declaration (import type) во избежание circular imports.

import type { GameRoomArbitrator } from "./GameRoomArbitrator";

export interface Env {
  ROOM_STATE: KVNamespace;
  GAME_ROOM: DurableObjectNamespace<GameRoomArbitrator>;
}