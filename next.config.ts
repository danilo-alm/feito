import type { NextConfig } from "next";

export default {
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
