import { generateRoomCode, ROOM_CODE_RE, type RoomSettings } from "@radioboi/game-core";

export type JoinResult = { success: true; roomId: string } | { error: string };

const LAN_STATIC = process.env.NEXT_PUBLIC_LAN_STATIC === "1";

export async function createRoom(settings?: Partial<RoomSettings>): Promise<string> {
  if (LAN_STATIC) {
    return generateRoomCode();
  }
  const { createRoomAction } = await import("@/src/server/room-actions");
  return createRoomAction(settings);
}

export async function joinRoom(code: string): Promise<JoinResult> {
  const normalized = code.trim().toUpperCase();
  if (!ROOM_CODE_RE.test(normalized)) {
    return { error: "Invalid room code" };
  }
  if (LAN_STATIC) {
    return { success: true, roomId: normalized };
  }
  const { joinRoomAction } = await import("@/src/server/room-actions");
  return joinRoomAction(code);
}
