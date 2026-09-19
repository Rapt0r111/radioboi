import { decode } from "@msgpack/msgpack";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

function unusedPort(): number {
  return 21000 + Math.floor(Math.random() * 8000);
}

function websocketKey(): string {
  return createHash("sha1").update(String(Math.random())).digest("base64");
}

function parseServerFrames(buffer: Buffer): Array<{ opcode: number; payload: Buffer }> {
  const frames: Array<{ opcode: number; payload: Buffer }> = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const byte1 = buffer[offset] ?? 0;
    const byte2 = buffer[offset + 1] ?? 0;
    const opcode = byte1 & 0x0f;
    let length = byte2 & 0x7f;
    let header = 2;
    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      header = 4;
    }
    if (offset + header + length > buffer.length) break;
    frames.push({
      opcode,
      payload: buffer.subarray(offset + header, offset + header + length),
    });
    offset += header + length;
  }
  return frames;
}

describe("node LAN server (Windows 8.1 runtime)", () => {
  const webRoot = mkdtempSync(join(tmpdir(), "radioboi-lan-"));
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>radioboi</title>ok");
  mkdirSync(join(webRoot, "game", "_"), { recursive: true });
  writeFileSync(join(webRoot, "game", "_", "index.html"), "<!doctype html>game");

  const webPort = unusedPort();
  const workerPort = unusedPort();
  const distDir = join(import.meta.dir, "..", "dist");
  const bundle = join(distDir, "lan-server.cjs");
  let child: ChildProcess | null = null;

  beforeAll(async () => {
    mkdirSync(distDir, { recursive: true });
    const built = Bun.spawnSync({
      cmd: [
        "bun",
        "build",
        join(import.meta.dir, "..", "src", "lan-server-main.ts"),
        "--outfile",
        bundle,
        "--target=node",
        "--format=cjs",
        "--packages=bundle",
      ],
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (built.exitCode !== 0) {
      throw new Error(`bun build failed: ${built.stderr.toString()}`);
    }

    child = spawn(
      "node",
      [
        bundle,
        "--web-port",
        String(webPort),
        "--worker-port",
        String(workerPort),
        "--web-root",
        webRoot,
        "--hostname",
        "127.0.0.1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const started = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 8_000);
      const onData = (chunk: Buffer) => {
        if (chunk.toString().indexOf("[radioboi-lan]") !== -1) {
          clearTimeout(timer);
          resolve(true);
        }
      };
      child?.stdout?.on("data", onData);
      child?.stderr?.on("data", onData);
    });
    if (!started) {
      throw new Error("Node LAN server did not print the ready line");
    }
  });

  afterAll(() => {
    if (child && child.pid) {
      child.kill();
    }
  });

  test("serves static index, SPA game rewrite, and worker health", async () => {
    const web = await fetch(`http://127.0.0.1:${webPort}/`);
    expect(web.status).toBe(200);
    expect(await web.text()).toContain("radioboi");

    const game = await fetch(`http://127.0.0.1:${webPort}/game/ABC123`);
    expect(game.status).toBe(200);
    expect(await game.text()).toContain("game");

    const health = await fetch(`http://127.0.0.1:${workerPort}/`);
    expect(health.status).toBe(200);
    const body = (await health.json()) as { service: string; runtime: string };
    expect(body.service).toBe("radioboi-worker");
    expect(body.runtime).toBe("node");
  });

  test("accepts a room WebSocket and sends SYNC_STATE", async () => {
    const key = websocketKey();
    const payload = await new Promise<Buffer>((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: workerPort });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("ws timeout"));
      }, 5_000);
      let buf = Buffer.alloc(0);
      socket.on("connect", () => {
        socket.write(
          `GET /room/ABC123?playerId=p1&playerName=Pilot HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${workerPort}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${key}\r\n` +
            `Sec-WebSocket-Version: 13\r\n` +
            `\r\n`,
        );
      });
      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const header = buf.subarray(0, headerEnd).toString("utf8");
        if (header.indexOf("101") === -1) {
          clearTimeout(timer);
          socket.destroy();
          reject(new Error(header));
          return;
        }
        const body = buf.subarray(headerEnd + 4);
        const frames = parseServerFrames(body);
        for (const frame of frames) {
          if (frame.opcode !== 2) continue;
          const decoded = decode(frame.payload) as { type?: string };
          if (decoded.type === "SYNC_STATE") {
            clearTimeout(timer);
            socket.end();
            resolve(frame.payload);
            return;
          }
        }
      });
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const decoded = decode(payload) as { type: string; payload: { phase?: string } };
    expect(decoded.type).toBe("SYNC_STATE");
    expect(decoded.payload.phase).toBe("lobby");
  });
});
