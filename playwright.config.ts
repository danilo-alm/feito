import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Testes ponta a ponta contra um servidor local em HTTPS (veja tests/e2e/README.md).
// FEITO_E2E_CERT fixa o certificado local pela chave pública, sem desligar a verificação de TLS.
const base = process.env.FEITO_E2E_URL ?? "https://127.0.0.1:3100";
const cert = process.env.FEITO_E2E_CERT;
const key = process.env.FEITO_E2E_KEY;
const url = new URL(base);
if (key && (!cert || url.protocol !== "https:" || url.hostname !== "127.0.0.1" || !url.port)) {
  throw new Error("Para iniciar o servidor, configure FEITO_E2E_CERT e uma URL HTTPS em 127.0.0.1 com porta explícita.");
}
const spki = cert
  ? createHash("sha256").update(new X509Certificate(readFileSync(cert)).publicKey.export({ type: "spki", format: "der" })).digest("base64")
  : null;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  webServer: key ? {
    command: [
      "unset MIGRATION_DATABASE_URL IDENTITY_ADMIN_DATABASE_URL KEY_MAINTENANCE_DATABASE_URL",
      "unset POSTGRES_BOOTSTRAP_PASSWORD POSTGRES_MIGRATOR_PASSWORD POSTGRES_IDENTITY_ADMIN_PASSWORD POSTGRES_APP_PASSWORD POSTGRES_AUTH_PASSWORD",
      "exec node tests/e2e/serve.mjs",
    ].join("\n"),
    env: { FEITO_E2E_PORT: url.port, NODE_ENV: "production" },
    url: new URL("/api/health", url).href,
    timeout: 120_000,
    reuseExistingServer: false,
  } : undefined,
  use: {
    baseURL: base,
    browserName: "chromium",
    headless: true,
    locale: "pt-BR",
    timezoneId: "America/Maceio",
    trace: "retain-on-failure",
    // Movimento reduzido: sem animações, a suíte fica rápida e determinística. O motion.spec.ts liga o
    // movimento de volta para validar saída animada e interrupções (docs/04-motion-and-interaction.md).
    reducedMotion: "reduce",
    launchOptions: { args: spki ? [`--ignore-certificate-errors-spki-list=${spki}`] : [] },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "celular", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
});
