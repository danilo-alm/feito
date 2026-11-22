import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webkit } from "@playwright/test";

const origin = new URL(process.env.FEITO_ORIGIN ?? "https://127.0.0.1:3100");
assert(origin.protocol === "https:" && origin.hostname === "127.0.0.1" && origin.port);
assert(process.env.FEITO_E2E_KEY && process.env.FEITO_E2E_CERT, "Set the disposable HTTPS key and certificate");
const profile = await mkdtemp(join(tmpdir(), "feito-webkit-product-"));
const serverEnv = { ...process.env, FEITO_E2E_PORT: origin.port };
for (const key of [
  "MIGRATION_DATABASE_URL", "IDENTITY_ADMIN_DATABASE_URL", "KEY_MAINTENANCE_DATABASE_URL",
  "POSTGRES_BOOTSTRAP_PASSWORD", "POSTGRES_MIGRATOR_PASSWORD", "POSTGRES_IDENTITY_ADMIN_PASSWORD",
  "POSTGRES_APP_PASSWORD", "POSTGRES_AUTH_PASSWORD",
]) delete serverEnv[key];

const server = spawn(process.execPath, ["tests/e2e/serve.mjs"], {
  cwd: new URL("../../", import.meta.url),
  env: serverEnv,
  stdio: "inherit",
});
const stopped = once(server, "exit");
let context;
try {
  let healthy = false;
  for (let attempt = 0; attempt < 30 && !healthy && server.exitCode === null; attempt++) {
    healthy = await fetch(new URL("/api/health/live", origin)).then((reply) => reply.ok, () => false);
    if (!healthy) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(healthy, "The disposable HTTPS server did not start");
  context = await webkit.launchPersistentContext(profile, { ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(new URL("/entrar", origin).href);
  assert(await page.evaluate(() => crossOriginIsolated));
  await page.getByRole("button", { name: "Use in this browser without an account" }).click();
  await page.getByRole("heading", { name: "Today", level: 1 }).waitFor();
  await page.goto(new URL("/entrada", origin).href);
  await page.getByRole("heading", { name: "Inbox", level: 1 }).waitFor();
  await page.keyboard.press("q");
  const title = "WebKit OPFS persistent profile";
  const input = page.getByRole("dialog").getByRole("textbox", { name: "Task title" });
  await input.fill(title);
  await input.press("Enter");
  await page.waitForFunction((title) => [...document.querySelectorAll("[data-task-id]")].some((row) =>
    /^[a-f0-9-]{36}$/.test(row.getAttribute("data-task-id") ?? "") &&
    row.querySelector(".t-title")?.textContent?.trim() === title,
  ), title);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.close();
  server.kill();
  await stopped;

  const reopened = await context.newPage();
  await reopened.goto(new URL("/entrada", origin).href);
  assert(await reopened.evaluate(() => crossOriginIsolated && !!navigator.serviceWorker.controller));
  await reopened.getByRole("button", { name: /Complete.*WebKit OPFS persistent profile/ }).waitFor();
  console.log("WebKit persistent profile: durable creation and offline reopening passed.");
} finally {
  if (server.exitCode === null && server.signalCode === null) server.kill();
  await stopped;
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
