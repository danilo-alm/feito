import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Testes ponta a ponta contra um servidor local em HTTPS (veja tests/e2e/README.md).
// FEITO_E2E_CERT fixa o certificado local pela chave pública, sem desligar a verificação de TLS.
const base = process.env.FEITO_E2E_URL ?? "https://127.0.0.1:3100";
const cert = process.env.FEITO_E2E_CERT;
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
  use: {
    baseURL: base,
    channel: "chrome",
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
    { name: "celular", use: { ...devices["Pixel 7"], channel: "chrome", viewport: { width: 390, height: 844 } } },
  ],
});
