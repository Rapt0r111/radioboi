const TRUE_FLAGS = new Set(["1", "true", "yes", "on"]);

export function envFlagEnabled(value: string | undefined): boolean {
  return TRUE_FLAGS.has((value ?? "").trim().toLowerCase());
}

/** Empty allowlist permits any Origin (LAN / local wrangler). */
export function isOriginAllowed(origin: string | null, allowlistRaw: string | undefined): boolean {
  const allowed = (allowlistRaw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (allowed.length === 0) return true;
  if (origin === null || origin.length === 0) return false;
  return allowed.includes(origin);
}

export class MessageRateLimiter {
  readonly #windows = new Map<string, { start: number; count: number }>();

  constructor(
    readonly limit = 40,
    readonly windowMs = 2_000,
  ) {}

  allow(key: string, now: number = Date.now()): boolean {
    const current = this.#windows.get(key);
    if (current === undefined || now - current.start >= this.windowMs) {
      this.#windows.set(key, { start: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= this.limit;
  }
}
