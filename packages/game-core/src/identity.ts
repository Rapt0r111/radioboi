export const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;
export const PLAYER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const MISSILE_ID_RE = /^[\p{L}\p{N}_-]{1,64}$/u;
export const SEAT_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Normalize a lobby code. Returns null when the value is not a 6-character room id. */
export function normalizeRoomId(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return ROOM_CODE_RE.test(normalized) ? normalized : null;
}

export function isValidPlayerId(value: string): boolean {
  return PLAYER_ID_RE.test(value);
}

export function isValidMissileId(value: string): boolean {
  return MISSILE_ID_RE.test(value);
}

export function isValidSeatToken(value: string): boolean {
  return SEAT_TOKEN_RE.test(value);
}

export function generateSeatToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
