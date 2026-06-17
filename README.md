# Radioboi

Radioboi is a realtime PvP Battleship-style game where attacks are sent with Morse code. The project is a Bun monorepo:

- `apps/web` - Next.js client.
- `apps/worker` - Cloudflare Worker with Durable Objects/WebSocket room runtime.
- `packages/game-core` - shared game rules and protocol types.
- `packages/morse-engine` - Morse input and audio engine.

## Windows Requirements

Install these before running the project:

- Windows 10/11 with PowerShell 5+.
- Bun `1.3.14` or newer compatible with the lockfile.
- Node.js available on `PATH` for the standalone Next server.
- Chromium browsers for Playwright if you run e2e tests: `bunx playwright install`.
- Cloudflare login only when deploying: `cd apps/worker; bunx wrangler login`.

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

Stop both processes:

```powershell
bun run stop:local
```

Logs are written to:

- `.omx/logs/worker-dev.log`
- `.omx/logs/web-dev.log`

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

The standalone web server validates the Next production build only. Real gameplay still needs a deployed or locally running Worker reachable through `NEXT_PUBLIC_WS_URL`.

For a production web build, set the WebSocket URL before building because `NEXT_PUBLIC_*` values are embedded into the client bundle:

```powershell
$env:NEXT_PUBLIC_WS_URL = "wss://<your-worker-host>"
bun run build
```

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
