import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    // O PostgreSQL e o Argon2 compartilham a CPU com a instrumentação nos runners do CI.
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      include: ["src/{app/api,client,domain,server,validation}/**/*.{ts,tsx}"],
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        "src/{app/api,domain,server,validation}/**/*.{ts,tsx}": { lines: 90, branches: 80 },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)),
    },
  },
});
