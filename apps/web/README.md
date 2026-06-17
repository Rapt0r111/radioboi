# Radioboi Web

This package is the Next.js client for Radioboi.

For normal local gameplay, run the full stack from the repository root:

```powershell
bun run dev:local
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
