import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:1421";

export default defineConfig({
  testDir: "tests/desktop",
  outputDir: "test-results/desktop",
  use: {
    baseURL, viewport: { width: 1180, height: 800 }, locale: "pt-BR", reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "linux", use: { userAgent: "Mozilla/5.0 (X11; Linux x86_64)" } },
    { name: "windows", use: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } },
    { name: "macos", use: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } },
  ],
  webServer: {
    command: "pnpm --filter @feito/desktop dev --port 1421",
    url: baseURL,
  },
});
