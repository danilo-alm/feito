import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:1421";

export default defineConfig({
  testDir: "tests/desktop",
  webServer: {
    command: "pnpm --filter @feito/desktop dev --port 1421",
    url: baseURL,
  },
  use: { baseURL, viewport: { width: 1180, height: 800 }, locale: "pt-BR", reducedMotion: "reduce" },
});
