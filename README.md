# Radioboi

Radioboi is a realtime PvP Battleship-style game where attacks are sent with Morse code. The project is a Bun monorepo:

- `apps/web` - Next.js client.
- `apps/worker` - Cloudflare Worker with Durable Objects/WebSocket room runtime.
- `packages/game-core` - shared game rules and protocol types.
- `packages/morse-engine` - Morse input and audio engine.

## Windows Requirements

**Development / packing machine**

- Windows 10/11 with PowerShell 5+.
- Bun `1.3.14` or newer compatible with the lockfile.
- Node.js on `PATH` is optional for packing (the offline bundle downloads Node 18.20.8).
- Chromium browsers for Playwright if you run e2e tests: `bunx playwright install`.
- Cloudflare login only when deploying: `cd apps/worker; bunx wrangler login`.

**Offline LAN server (including Windows 8.1 build 9600)**

Pack on Windows 10/11 (`bun run server:pack`), copy `local-server/offline/` to the target PC. The target does **not** need Bun or wrangler.

- Windows 8.1 x64 (build 9600) or Windows 10/11 x64
- PowerShell 4+ (ships with Windows 8.1)
- Bundled Node.js **18.20.8** in `runtime\node\`
- Browser: Chrome 109 or Firefox 115 ESR (last versions for Windows 8.1)
- If `node.exe` fails to start: install [KB2999226](https://support.microsoft.com/help/2999226) (Universal C Runtime)

The LAN process is a single Node server: static UI on port 3000 and game WebSocket on 8787.

Check local versions:

```powershell
bun --version
node --version
```

## Install

From the repository root:

```powershell
bun install --frozen-lockfile
```

If the lockfile intentionally changes after dependency edits, run `bun install` and commit the updated `bun.lock`.

## Local Game Startup On Windows

Full local gameplay requires both processes:

- Worker/WebSocket server on `http://127.0.0.1:8787`.
- Next.js web client on `http://127.0.0.1:3000`.

Start both with one command:

```powershell
bun run dev:local
```

Open:

```text
http://127.0.0.1:3000
```

### LAN server (any local IP)

For a Windows machine that hosts the game for other devices on the LAN, use the
dedicated entry folder:

```text
local-server\
```

**Offline production server (no internet on the target PC):** build a portable
package on a machine that has internet, then copy the result:

```powershell
bun run server:pack
bun run server:verify
bun run server:verify:smoke
```

That writes `local-server/offline/` (optional zip under `local-server/offline-zip/`)
containing:

- `runtime/` — Bun + Node binaries (no system install on the server)
- `cache/` — Bun package cache for offline `bun install`
- `app/` — full project + lockfile + `node_modules` + **production** standalone build
- `start.bat` / `stop.bat` / `verify.bat` / `allow-firewall.bat`

Copy **the entire `offline` folder** to the air-gapped host and run `start.bat`.
After the folder is moved, the first start re-links workspace dependencies from
`cache/` without the network (standalone build is preserved).  
Full guide (RU): `local-server/PRODUCTION-OFFLINE.md` · short: `local-server/README.md`.

**Online / monorepo host:** double-click `local-server\start.bat`, or:

```powershell
bun run server:start
# production web (standalone) + local worker:
bun run server:start:prod
# or: bun run dev:lan:prod
```

Offline packages prefer **production** web when a prebuilt standalone exists
(created by `server:pack`). Use `start.ps1 -Dev` to force `next dev`.

LAN mode is **IP-agnostic**:

- Web and Worker bind to `0.0.0.0` (all interfaces).
- The client opens a WebSocket to **the same hostname** the page was loaded from
  (`ws://<page-host>:8787`). You do not need to hardcode a machine IP.
- Players may open any of this PC's addresses (`192.168.*`, `10.*`, etc.).

Equivalent from the repo root:

```powershell
bun run dev:lan
```

The script prints every detected local URL, for example:

```text
http://192.168.206.1:3000   (preferred)
http://10.0.0.15:3000
http://127.0.0.1:3000
```

To only prefer a display address (clients can still use any IP):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1 -Lan -PublicHost 192.168.206.1
```

Allow both ports in Windows Firewall if the page opens but game actions still
stay disconnected: `3000` for the web app and `8787` for the Worker/WebSocket.
The firewall is normally inbound-blocked on Windows. Open an elevated PowerShell
and run:

```powershell
bun run lan:firewall
```

Or double-click `local-server\allow-firewall.bat` as Administrator.

This allows TCP `3000` and `8787` only from the local subnet on the Private
network profile. To remove the rules later:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/allow-lan-firewall.ps1 -Remove
```

Stop both processes:

```powershell
bun run stop:local
```

Or `local-server\stop.bat` / `bun run server:stop`.

The script prints the exact log paths. Logs are written under `.omx/logs/` as
`worker-dev-*.log` and `web-dev-*.log`.

If ports are busy, use the script directly:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1 -WebPort 3001 -WorkerPort 8788
```

## Manual Local Startup

Use this when debugging one side of the stack.

Terminal 1:

```powershell
cd apps/worker
bun run dev -- --port 8787 --ip 127.0.0.1
```

Terminal 2:

```powershell
cd apps/web
$env:NEXT_PUBLIC_WS_URL = "ws://127.0.0.1:8787"
bun run dev -- --hostname 127.0.0.1 -p 3000
```

For manual LAN startup, bind both sides to `0.0.0.0` and leave
`NEXT_PUBLIC_WS_URL` unset (or set only `NEXT_PUBLIC_WS_PORT`) so the browser
uses the same host as the page:

```powershell
cd apps/worker
bun run dev -- --port 8787 --ip 0.0.0.0

# other terminal
cd apps/web
$env:NEXT_PUBLIC_WS_PORT = "8787"
# do not set NEXT_PUBLIC_WS_URL for multi-IP LAN
bun run dev -- --hostname 0.0.0.0 -p 3000
```

## Release Verification

Run the Windows release gate:

```powershell
bun run release:check
```

That script runs:

1. `bun install --frozen-lockfile`
2. `bun run lint`
3. `bun run type-check`
4. `bun run test`
5. `bun run build`
6. `bun run test:e2e`

Skip e2e only for a quick local pass:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/release-check.ps1 -SkipE2E
```

## Production-Style Web Smoke

Build first:

```powershell
bun run build
```

Start the standalone web server:

```powershell
bun run start:web
```

The standalone web server validates the Next production build only. Real gameplay
still needs a Worker (local wrangler or Cloudflare). Full local production stack:

```powershell
bun run server:start:prod
```

### WebSocket URL at build time

`NEXT_PUBLIC_*` values are embedded into the client bundle:

| Target | Before `bun run build` |
|--------|-------------------------|
| Cloudflare production | `$env:NEXT_PUBLIC_WS_URL = "wss://<your-worker-host>"` |
| LAN / offline (any IP) | **leave unset**; optional `$env:NEXT_PUBLIC_WS_PORT = "8787"` |

When `NEXT_PUBLIC_WS_URL` is unset, the browser connects to
`ws(s)://<page-hostname>:<NEXT_PUBLIC_WS_PORT|8787>`.

Room create/join also works without Cloudflare KV (Node standalone / offline):
the Worker creates the room on first WebSocket connect; settings come from the
creator's client session.

## Worker Deploy

Deploying writes to Cloudflare. Confirm account/credentials before running:

```powershell
cd apps/worker
bunx wrangler whoami
bun run deploy
```

The Worker config lives in `apps/worker/wrangler.toml`.

## Troubleshooting

- Browser connects but game does not progress: confirm the Worker is running and `NEXT_PUBLIC_WS_URL` points to it.
- `8787` or `3000` is busy: stop the old stack with `bun run stop:local`, or pass custom ports to `scripts/start-local.ps1`.
- Playwright browsers are missing: run `bunx playwright install`.
- Standalone web start fails: run `bun run build` first and check that `apps/web/.next/standalone/apps/web/server.js` exists.
