# Radioboi Web

This package is the Next.js client for Radioboi.

For normal local gameplay, run the full stack from the repository root:

```powershell
bun run dev:local
```

For gameplay from another laptop on the same network (any local IP works):

```powershell
bun run server:start
# production web + local worker:
bun run server:start:prod
# or: bun run dev:lan
# or: double-click local-server\start.bat
```

WebSocket uses the page hostname automatically. See `local-server/README.md`.
Offline packages start production web by default when prebuilt.

To only change which URL is printed first:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1 -Lan -PublicHost 192.168.206.1
```

For web-only development:

```powershell
$env:NEXT_PUBLIC_WS_URL = "ws://127.0.0.1:8787"
bun run dev -- --hostname 127.0.0.1 -p 3000
```

Build and start the standalone web server:

```powershell
bun run build
bun run start
```

The standalone server is web-only. A real game session also needs the Cloudflare Worker/WebSocket runtime from `apps/worker`.
