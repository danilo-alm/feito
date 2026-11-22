import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  resolve: {
    dedupe: ["react", "react-dom", "@dnd-kit/core", "@js-temporal/polyfill", "zod"],
  },
  build: {
    rolldownOptions: {
      onLog(level, log, defaultHandler) {
        // O desktop é todo cliente; a diretiva continua necessária no Next.js do web.
        if (level === "warn" && log.code === "MODULE_LEVEL_DIRECTIVE" && log.message.includes('"use client"')) return;
        defaultHandler(level, log);
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  test: { include: ["src/**/*.test.ts"] },
});
