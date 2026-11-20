import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  resolve: {
    dedupe: ["react", "react-dom", "@dnd-kit/core", "@js-temporal/polyfill", "zod"],
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  test: { include: ["src/**/*.test.ts"] },
});
