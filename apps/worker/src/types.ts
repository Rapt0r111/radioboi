// apps/worker/src/types.ts
// Shared bindings — imported by BOTH index.ts and GameRoomArbitrator.ts
// Kept separate to break the circular-import chain.

export interface Env {
  ROOM_STATE: KVNamespace;           // matches [[kv_namespaces]] binding
  GAME_ROOM:  DurableObjectNamespace; // matches [durable_objects] name
}