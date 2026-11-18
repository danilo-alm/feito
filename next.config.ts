import type { NextConfig } from "next";

export default {
  // Servidor autocontido usado pela imagem de produção (Dockerfile, stage prod).
  output: "standalone",
  serverExternalPackages: ["@node-rs/argon2", "pg", "pino"],
  logging: false,
  devIndicators: false,
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/api/:path*",
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
    }];
  },
} satisfies NextConfig;
