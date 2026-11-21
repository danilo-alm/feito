import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = fileURLToPath(new URL("../../", import.meta.url));

export default {
  // Servidor autocontido usado pela imagem de produção (Dockerfile, stage prod).
  output: "standalone",
  outputFileTracingRoot: root,
  turbopack: { root },
  transpilePackages: ["@feito/core", "@feito/ui"],
  serverExternalPackages: ["@node-rs/argon2", "pg", "pino"],
  logging: false,
  devIndicators: false,
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/api/:path*",
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
    }, {
      source: "/service-worker.js",
      headers: [{ key: "Cache-Control", value: "no-cache" }],
    }];
  },
} satisfies NextConfig;
