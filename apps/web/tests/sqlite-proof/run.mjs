import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";
import { sqliteProofAssets, vendorNames } from "./assets.mjs";

const [engine = "chromium", volume = "10000", vfs = "opfs"] = process.argv.slice(2);
const browserType = { chromium, firefox, webkit }[engine];
const size = Number(volume);
assert(browserType && Number.isSafeInteger(size) && size > 2, "Supply chromium, firefox or webkit and a task count > 2");
assert(["opfs", "opfs-sahpool"].includes(vfs), "Supply opfs or opfs-sahpool");
const serviceWorker = await readFile(new URL("../../src/offline/service-worker.js", import.meta.url), "utf8");
const shell = "<!doctype html><title>Feito SQLite proof</title>" +
  `<script type="module" src="/client.mjs?vfs=${vfs}"></script>`;
const assets = new Map((await sqliteProofAssets({ benchmark: true })).map(([name, bytes]) => [
  "/" + name, [bytes, name.endsWith(".wasm") ? "application/wasm" : "text/javascript"],
]));
assets.set("/proof-shell.html", [shell, "text/html"]);
const manifest = {
  build: "sqlite-proof",
  shell: "/proof-shell.html",
  entries: [...assets].map(([url, [content]]) => ({
    url, integrity: "sha256-" + createHash("sha256").update(content).digest("base64"),
  })),
};
const directory = await mkdtemp(join(tmpdir(), "feito-sqlite-proof-"));
let server;
let context;
let offline = false;
try {
  const key = join(directory, "key.pem");
  const certificate = join(directory, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
    "-keyout", key, "-out", certificate], { stdio: "ignore" });
  const cert = await readFile(certificate);
  const publicKey = new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
  const fingerprint = createHash("sha256").update(publicKey).digest("base64");
  server = createServer({ key: await readFile(key), cert }, (request, response) => {
    if (offline) {
      response.writeHead(503).end();
      return;
    }
    if (vfs === "opfs") {
      response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    }
    const { pathname } = new URL(request.url, "https://localhost");
    if (pathname === "/service-worker.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" })
        .end(`const packageFiles = ${JSON.stringify(manifest)};\n${serviceWorker}`);
      return;
    }
    const asset = assets.get(pathname === "/" ? "/proof-shell.html" : pathname);
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    const [content, type] = asset;
    response.writeHead(200, { "Content-Type": type }).end(content);
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const url = "https://127.0.0.1:" + server.address().port;
  context = await browserType.launchPersistentContext(join(directory, "profile"), {
    executablePath: process.env.FEITO_SQLITE_BROWSER,
    ignoreHTTPSErrors: true,
    args: engine === "chromium" ? [
      "--disable-crash-reporter", "--disable-crashpad-for-testing",
      "--ignore-certificate-errors-spki-list=" + fingerprint,
    ] : [],
  });
  async function openTab(path = "/") {
    const page = await context.newPage();
    page.on("console", (entry) => {
      if (process.env.FEITO_SQLITE_VERBOSE && entry.type() !== "debug") console.error(entry.text());
    });
    await page.goto(url + path);
    await page.waitForFunction(() => typeof window.run === "function", undefined, { timeout: 10_000 });
    assert.equal(await page.evaluate(() => crossOriginIsolated), vfs === "opfs");
    return page;
  }
  const run = (page, command, args) => page.evaluate(([command, args]) => window.run(command, args), [command, args]);
  const first = await openTab();
  const browser = await first.evaluate(() => navigator.userAgent);
  const setup = await run(first, "setup", { size });
  assert.equal(setup.result.journal, "delete");
  assert(setup.result.index.some(({ detail }) => detail.includes("proof_tasks_by_project")));
  await first.evaluate(async () => {
    await navigator.serviceWorker.register("/service-worker.js");
    await navigator.serviceWorker.ready;
  });
  await first.waitForFunction(() => !!navigator.serviceWorker.controller);
  const second = await openTab();
  const request = { taskId: 1, title: "First edit", operationId: "first" };
  await assert.rejects(run(first, "editTask", { ...request, rollback: true }), /Forced rollback/);
  assert.equal((await run(second, "readProject", { projectId: 1 })).result[0].title, "Task 1");
  assert.deepEqual((await run(second, "readQueue")).result, []);
  const edits = await Promise.all([
    run(first, "editTask", request).then(async (reply) => { await first.close(); return reply; }),
    run(second, "editTask", { taskId: 2, title: "Second edit", operationId: "second" }),
  ]);
  assert.equal(edits[0].result, "committed");
  assert(["committed", "duplicate"].includes(edits[1].result));
  if (vfs === "opfs-sahpool") {
    await second.waitForFunction(() => window.proofOwner);
    assert.equal((await run(second, "editTask", { ...request, title: "Do not replay" })).result, "duplicate");
  }
  await second.close();
  offline = true;
  const reopened = await openTab("/navegador");
  const cold = await run(reopened, "readProject", { projectId: 1 });
  const warm = await run(reopened, "readProject", { projectId: 1 });
  assert.equal(cold.result[0].title, "First edit");
  assert.equal((await run(reopened, "readProject", { projectId: 2 })).result[0].title, "Second edit");
  const queue = await run(reopened, "readQueue");
  assert.deepEqual(queue.result.map(({ id }) => id).sort(), ["first", "second"]);
  assert.equal((await run(reopened, "editTask", { ...request, title: "Do not replay" })).result, "duplicate");
  assert.equal((await run(reopened, "readProject", { projectId: 1 })).result[0].title, "First edit");
  await run(reopened, "setupRelational");
  const selection = { spaceId: "remote", epoch: "epoch", generation: 12 };
  const edit = {
    selection, taskId: "task", revision: 1, title: "Relational edit",
    operation: {
      id: "relational-edit", method: "PATCH", path: "/tasks/task",
      authoredAt: "2026-11-22T00:00:00Z", body: { revision: 1, title: "Relational edit" },
    },
  };
  assert.equal((await run(reopened, "readRelationalTask", { selection, id: "task" })).result.title, "Original task");
  assert.deepEqual((await run(reopened, "commitRelationalTitle", edit)).result, { generation: 13, revision: 2 });
  assert.equal((await run(reopened, "commitRelationalTitle", edit)).result, "duplicate");
  await reopened.close();
  const relational = await openTab("/navegador");
  assert.equal((await run(relational, "readRelationalTask", { selection: { ...selection, generation: 13 }, id: "task" })).result.title, "Relational edit");
  const indexedDb = await relational.evaluate(async (size) => {
    const benchmark = await import("/benchmark.mjs");
    return benchmark.seedAndEdit(size);
  }, size);
  await relational.close();
  const baseline = await openTab("/navegador");
  const indexedDbReads = await baseline.evaluate(async () => {
    const benchmark = await import("/benchmark.mjs");
    return { reopenMs: await benchmark.readProject(), warmProjectMs: await benchmark.readProject() };
  });
  const vendorBytes = vendorNames.reduce((total, name) => total + assets.get("/" + name)[0].length, 0);
  console.log(JSON.stringify({
    engine, browser, vfs, tasks: size, ...setup.result, vendorBytes,
    initAndSeedMs: setup.ms, editMs: edits.map(({ ms }) => ms), reopenMs: cold.ms, warmProjectMs: warm.ms,
    indexedDb: { ...indexedDb, ...indexedDbReads },
  }, null, 2));
} finally {
  await context?.close();
  server?.close();
  await rm(directory, { recursive: true, force: true });
}
