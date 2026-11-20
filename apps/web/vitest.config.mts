import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const productSources = "{apps/web/src,packages/core/src}/{app/api,server,validation,domain,product}/**/*.{ts,tsx}";

export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  test: {
    include: ["apps/web/tests/**/*.test.ts"],
    // O PostgreSQL e o Argon2 compartilham a CPU com a instrumentação nos runners do CI.
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reportsDirectory: "apps/web/coverage",
      include: [productSources, "packages/ui/src/client/**/*.{ts,tsx}"],
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        [productSources]: { lines: 90, branches: 80 },
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
