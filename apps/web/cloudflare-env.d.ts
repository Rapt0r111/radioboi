// apps/web/cloudflare-env.d.ts
//
// Минимальные объявления типов Cloudflare для web-приложения.
// НЕ импортируем @cloudflare/workers-types целиком, так как он конфликтует с DOM lib.
// Вместо этого объявляем только нужные интерфейсы локально.
//
// Этот файл автоматически подхватывается tsconfig.json через glob "**/*.ts".

// ── Минимальный интерфейс KVNamespace ────────────────────────────────────────
// Покрывает только методы, используемые в actions.ts.

interface KVNamespaceGetOptions {
  type?: "text" | "json" | "arrayBuffer" | "stream";
  cacheTtl?: number;
}

interface KVNamespacePutOptions {
  expiration?: number;
  expirationTtl?: number;
  metadata?: unknown;
}

interface KVNamespace {
  get(key: string, options?: KVNamespaceGetOptions): Promise<string | null>;
  put(
    key: string,
    value: string | ReadableStream | ArrayBuffer,
    options?: KVNamespacePutOptions,
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

// ── Аугментация CloudflareEnv ─────────────────────────────────────────────────
// @opennextjs/cloudflare экспортирует пустой интерфейс CloudflareEnv.
// Здесь объявляем биндинги из wrangler.toml, чтобы getCloudflareContext()
// возвращал правильный тип для env.ROOM_STATE.

interface CloudflareEnv {
  ROOM_STATE: KVNamespace;
}
