import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const root = fileURLToPath(new URL("../../", import.meta.url));

export default function config(phase: string): NextConfig {
  const buildId = randomUUID();
  const workerUrl = phase === PHASE_DEVELOPMENT_SERVER
    ? "/sqlite-dev/worker.mjs" : `/_next/static/${buildId}/sqlite/worker.mjs`;
  return {
    generateBuildId: () => buildId,
    env: { FEITO_BUILD: buildId, FEITO_SQLITE_WORKER: workerUrl },
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
      }, {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      }];
    },
  };
}
