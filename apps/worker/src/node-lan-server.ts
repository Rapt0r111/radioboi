// Node 18 LAN server for Windows 8.1 (build 9600).
// Serves the static Next export on --web-port and the game WebSocket worker on --worker-port.
// No Bun, wrangler, or workerd.

import "./node-crypto-polyfill";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { GameRoomSession } from "./GameRoomSession";
import { MemoryRoomHost } from "./memory-room-host";
import type { TaggedWebSocket } from "./room-host";

type CliOptions = {
  webPort: number;
  workerPort: number;
  hostname: string;
  webRoot: string;
  allowedOrigins: string;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

const SECURITY_HEADERS: Array<[string, string]> = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "same-origin"],
  ["Permissions-Policy", "autoplay=(self)"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
  ["X-DNS-Prefetch-Control", "off"],
  [
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join("; "),
  ],
];

function argValue(argv: string[], name: string, fallback: string): string {
  const prefix = `--${name}=`;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (token === `--${name}`) {
      return argv[i + 1] ?? fallback;
    }
    if (token.indexOf(prefix) === 0) {
      return token.slice(prefix.length);
    }
  }
  return fallback;
}

export function parseCli(argv: string[], env: NodeJS.ProcessEnv): CliOptions {
  return {
    webPort: Number(argValue(argv, "web-port", env.PORT || env.WEB_PORT || "3000")),
    workerPort: Number(argValue(argv, "worker-port", env.WORKER_PORT || "8787")),
    hostname: argValue(argv, "hostname", env.HOSTNAME || "0.0.0.0"),
    webRoot: argValue(argv, "web-root", env.WEB_ROOT || ""),
    allowedOrigins: argValue(argv, "allowed-origins", env.ALLOWED_ORIGINS || ""),
  };
}

function applySecurityHeaders(res: ServerResponse): void {
  for (const [key, value] of SECURITY_HEADERS) {
    res.setHeader(key, value);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  applySecurityHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  applySecurityHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function safeFilePath(webRoot: string, urlPath: string): string | null {
  const raw = urlPath.split("?")[0] ?? "/";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.indexOf("\0") !== -1) return null;
  const relative = decoded.replace(/^\/+/, "").replace(/\//g, sep);
  const resolved = resolve(webRoot, relative);
  const rootResolved = resolve(webRoot);
  if (resolved !== rootResolved && resolved.indexOf(rootResolved + sep) !== 0) {
    return null;
  }
  return resolved;
}

function firstExisting(paths: string[]): string | null {
  for (const candidate of paths) {
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        /* skip */
      }
    }
  }
  return null;
}

function resolveStaticFile(webRoot: string, urlPath: string): string | null {
  const pathname = (urlPath.split("?")[0] ?? "/").replace(/\\/g, "/");
  const gameMatch = pathname.match(/^\/game\/([A-Za-z0-9]{6})\/?$/);
  if (gameMatch) {
    const fallback = firstExisting([
      join(webRoot, "game", "_", "index.html"),
      join(webRoot, "game", "_.html"),
    ]);
    if (fallback) return fallback;
  }

  const direct = safeFilePath(webRoot, pathname);
  if (!direct) return null;

  const candidates = [direct];
  if (pathname.endsWith("/")) {
    candidates.push(join(direct, "index.html"));
  } else {
    candidates.push(`${direct}.html`);
    candidates.push(join(direct, "index.html"));
  }
  if (pathname === "/" || pathname === "") {
    candidates.push(join(webRoot, "index.html"));
  }
  return firstExisting(candidates);
}

function pipeFile(req: IncomingMessage, res: ServerResponse, filePath: string): void {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(filePath);
  } catch {
    sendText(res, 404, "Not found");
    return;
  }

  const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;
  applySecurityHeaders(res);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", type);

  if (range && range.indexOf("bytes=") === 0) {
    const spec = range.slice("bytes=".length).split("-");
    const start = Number(spec[0] || "0");
    const end = spec[1] ? Number(spec[1]) : stat.size - 1;
    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 0 ||
      end >= stat.size ||
      start > end
    ) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${stat.size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Content-Length", end - start + 1);
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Length", stat.size);
  createReadStream(filePath).pipe(res);
}

function createWebHandler(webRoot: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const urlPath = req.url || "/";
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendText(res, 405, "Method not allowed");
      return;
    }
    if (!webRoot || !existsSync(webRoot)) {
      sendText(res, 500, "Web root missing. Rebuild with RADIOBOI_LAN_STATIC=1.");
      return;
    }
    const filePath = resolveStaticFile(webRoot, urlPath);
    if (!filePath) {
      sendText(res, 404, "Not found");
      return;
    }
    if (req.method === "HEAD") {
      try {
        const stat = statSync(filePath);
        applySecurityHeaders(res);
        res.statusCode = 200;
        res.setHeader("Content-Type", MIME[extname(filePath).toLowerCase()] || "application/octet-stream");
        res.setHeader("Content-Length", stat.size);
        res.end();
      } catch {
        sendText(res, 404, "Not found");
      }
      return;
    }
    pipeFile(req, res, filePath);
  };
}

class NodeSocket implements TaggedWebSocket {
  readyState = 1;
  readonly #send: (data: Uint8Array | string) => void;
  readonly #closer: (code?: number, reason?: string) => void;

  constructor(
    send: (data: Uint8Array | string) => void,
    closer: (code?: number, reason?: string) => void,
  ) {
    this.#send = send;
    this.#closer = closer;
  }

  send(data: Uint8Array | string): void {
    if (this.readyState !== 1) return;
    this.#send(data);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === 2 || this.readyState === 3) return;
    this.readyState = 2;
    this.#closer(code, reason);
  }

  markClosed(): void {
    this.readyState = 3;
  }
}

type WsFrame = { opcode: number; payload: Buffer; fin: boolean };

function readFrame(buffer: Buffer): { frame: WsFrame; rest: Buffer } | null {
  if (buffer.length < 2) return null;
  const byte1 = buffer[0] ?? 0;
  const byte2 = buffer[1] ?? 0;
  const fin = (byte1 & 0x80) !== 0;
  const opcode = byte1 & 0x0f;
  const masked = (byte2 & 0x80) !== 0;
  let length = byte2 & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const big = buffer.readUInt32BE(2);
    if (big !== 0) {
      return { frame: { opcode: 8, payload: Buffer.alloc(0), fin: true }, rest: Buffer.alloc(0) };
    }
    length = buffer.readUInt32BE(6);
    offset = 10;
  }
  const maskSize = masked ? 4 : 0;
  if (buffer.length < offset + maskSize + length) return null;
  let payload = buffer.subarray(offset + maskSize, offset + maskSize + length);
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    const unmasked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i += 1) {
      unmasked[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
    }
    payload = unmasked;
  }
  return {
    frame: { opcode, payload, fin },
    rest: buffer.subarray(offset + maskSize + length),
  };
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }
  return Buffer.concat([header, payload]);
}

function websocketAccept(key: string): string {
  return createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

type RoomEntry = { host: MemoryRoomHost; session: GameRoomSession };

function toArrayBufferView(payload: Buffer): Uint8Array {
  return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
}

export function createLanRuntime(options: CliOptions) {
  const rooms = new Map<string, RoomEntry>();
  const webRoot = options.webRoot ? resolve(options.webRoot) : "";

  function getRoom(roomId: string): RoomEntry {
    let entry = rooms.get(roomId);
    if (!entry) {
      const host = new MemoryRoomHost();
      const session = new GameRoomSession(host, { ALLOWED_ORIGINS: options.allowedOrigins });
      host.onAlarm = () => {
        void session.alarm();
      };
      entry = { host, session };
      rooms.set(roomId, entry);
    }
    return entry;
  }

  const workerServer = createServer((req, res) => {
    const urlPath = (req.url || "/").split("?")[0];
    if (urlPath === "/" || urlPath === "/health") {
      sendJson(res, 200, { service: "radioboi-worker", status: "ok", runtime: "node" });
      return;
    }
    sendText(res, 404, "Not found");
  });

  workerServer.on("upgrade", (req, socket, _head) => {
    const upgrade = (req.headers.upgrade || "").toLowerCase();
    if (upgrade !== "websocket") {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || key.length === 0) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const hostHeader = req.headers.host || "127.0.0.1";
    const requestUrl = `http://${hostHeader}${req.url || "/"}`;
    const pathname = (req.url || "/").split("?")[0] ?? "/";
    const roomMatch = pathname.match(/^\/room\/([^/]+)$/);
    if (!roomMatch) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const originHeader = req.headers.origin;
    const origin = typeof originHeader === "string" ? originHeader : null;
    const tempSession = new GameRoomSession(new MemoryRoomHost(), {
      ALLOWED_ORIGINS: options.allowedOrigins,
    });
    const parsed = tempSession.parseJoin(requestUrl, origin);
    if (!parsed.ok) {
      socket.write(`HTTP/1.1 ${parsed.status} Error\r\nConnection: close\r\n\r\n${parsed.body}`);
      socket.destroy();
      return;
    }

    const accept = websocketAccept(key);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        "\r\n",
    );

    const room = getRoom(parsed.join.roomId);
    let closed = false;
    const nodeSocket = new NodeSocket(
      (data) => {
        if (closed) return;
        const payload = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
        socket.write(encodeFrame(2, payload));
      },
      (code, reason) => {
        if (closed) return;
        closed = true;
        const reasonBuf = Buffer.from(reason ?? "");
        const payload = Buffer.alloc(2 + reasonBuf.length);
        payload.writeUInt16BE(code ?? 1000, 0);
        reasonBuf.copy(payload, 2);
        try {
          socket.write(encodeFrame(8, payload));
        } catch {
          /* ignore */
        }
        socket.end();
        nodeSocket.markClosed();
        room.host.forgetWebSocket(nodeSocket);
        void room.session.webSocketClose(nodeSocket, code ?? 1000, reason ?? "");
      },
    );

    void room.session.completeJoin(nodeSocket, parsed.join);

    let extra = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      extra = Buffer.concat([extra, chunk]);
      while (true) {
        const parsedFrame = readFrame(extra);
        if (!parsedFrame) break;
        extra = parsedFrame.rest;
        const frame = parsedFrame.frame;
        if (frame.opcode === 8) {
          nodeSocket.close(1000, "client close");
          return;
        }
        if (frame.opcode === 9) {
          socket.write(encodeFrame(10, frame.payload));
          continue;
        }
        if (frame.opcode === 1) {
          void room.session.webSocketMessage(nodeSocket, frame.payload.toString("utf8"));
          continue;
        }
        if (frame.opcode === 2) {
          void room.session.webSocketMessage(nodeSocket, toArrayBufferView(frame.payload));
        }
      }
    });

    socket.on("close", () => {
      if (closed) return;
      closed = true;
      nodeSocket.markClosed();
      room.host.forgetWebSocket(nodeSocket);
      void room.session.webSocketClose(nodeSocket, 1006, "socket closed");
    });

    socket.on("error", () => {
      if (closed) return;
      closed = true;
      nodeSocket.markClosed();
      room.host.forgetWebSocket(nodeSocket);
      void room.session.webSocketError(nodeSocket);
    });
  });

  const webServer = createServer(createWebHandler(webRoot));

  return {
    options,
    webRoot,
    workerServer,
    webServer,
    async listen(): Promise<void> {
      await new Promise<void>((resolveListen, reject) => {
        workerServer.once("error", reject);
        workerServer.listen(options.workerPort, options.hostname, () => {
          workerServer.removeListener("error", reject);
          resolveListen();
        });
      });
      await new Promise<void>((resolveListen, reject) => {
        webServer.once("error", reject);
        webServer.listen(options.webPort, options.hostname, () => {
          webServer.removeListener("error", reject);
          resolveListen();
        });
      });
      console.log(
        `[radioboi-lan] web http://${options.hostname}:${options.webPort}  worker ws://${options.hostname}:${options.workerPort}  root=${webRoot || "(none)"}`,
      );
    },
    async close(): Promise<void> {
      await Promise.all([
        new Promise<void>((resolveClose) => workerServer.close(() => resolveClose())),
        new Promise<void>((resolveClose) => webServer.close(() => resolveClose())),
      ]);
      rooms.forEach((entry) => {
        entry.host.dispose();
      });
      rooms.clear();
    },
  };
}

