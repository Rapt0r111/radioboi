// Путь: /apps/web/next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Compiler — promoted to root config in Next.js 15.3+.
  // If you downgrade to <15.3, move this inside `experimental: {}`.
  reactCompiler: true,

  // `standalone` output is required by @opennextjs/cloudflare.
  output: "standalone",

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options",  value: "nosniff"   },
          { key: "X-Frame-Options",          value: "DENY"      },
          { key: "Referrer-Policy",          value: "same-origin" },
          // autoplay=(self) is required for Morse audio via Web Audio API.
          { key: "Permissions-Policy",       value: "autoplay=(self)" },
        ],
      },
    ];
  },

  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;