export const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;
const ROOM_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Unbiased 6-character A-Z0-9 room code (LAN lobby + Cloudflare create). */
export function generateRoomCode(): string {
  const chars: string[] = [];
  while (chars.length < 6) {
    const bytes = new Uint8Array(6 - chars.length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      // 252 is the largest multiple of 36 below 256 — reject the remainder to
      // avoid modulo bias on the 36-character alphabet.
      if (byte < 252) chars.push(ROOM_CODE_CHARS[byte % 36] as string);
      if (chars.length === 6) break;
    }
  }
  return chars.join("");
}
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
