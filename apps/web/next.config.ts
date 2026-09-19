// apps/web/next.config.ts

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const lanStatic =
  process.env.RADIOBOI_LAN_STATIC === "1" || process.env.NEXT_PUBLIC_LAN_STATIC === "1";

if (!lanStatic) {
  const require = createRequire(import.meta.url);
  require("@opennextjs/cloudflare").initOpenNextCloudflareForDev();
}

// Monorepo / offline-package root (apps/web -> ../..). Pinning this prevents
// Next from walking up to a parent lockfile when building inside
// local-server/offline/app (nested under the real monorepo).
const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const allowedDevOrigins =
  process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0) ?? [];

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: lanStatic ? "export" : "standalone",
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  typescript: { ignoreBuildErrors: false },
};

if (lanStatic) {
  nextConfig.images = { unoptimized: true };
} else {
  nextConfig.allowedDevOrigins = allowedDevOrigins;
  nextConfig.headers = async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "autoplay=(self)" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "X-DNS-Prefetch-Control", value: "off" },
        {
          key: "Content-Security-Policy",
          value: [
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
        },
      ],
    },
  ];
}

export default nextConfig;
