import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { SQLiteTitleEdit } from "@feito/core/product/sqlite-batches";

const mode = process.env.FEITO_SQLITE_PROOF;

function run(page: Page, command: string, args?: unknown) {
  return page.evaluate(async ({ command, args }) => {
    const connection = globalThis as unknown as { run(command: string, args: unknown): Promise<{ result: unknown }> };
    return (await connection.run(command, args)).result;
  }, { command, args });
}

test("opens the SQLite proof from the Next.js build after going offline", async ({ page, context, request }) => {
  test.skip(mode !== "opfs" && mode !== "opfs-sahpool", "Requires an explicitly enabled proof build");
  const build = readFileSync(".next/BUILD_ID", "utf8").trim();
  const path = `/_next/static/${build}/sqlite-proof`;
  const script = `${path}/client.mjs?vfs=${mode}`;
  expect((await request.get(`${path}/sqlite3.wasm`)).headers()["content-type"]).toContain("application/wasm");
  const load = (target: Page) => target.evaluate(async (module) => { await import(module); }, script);

  await page.goto("/entrar");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/service-worker.js");
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await load(page);

  const selection = { spaceId: "remote", epoch: "epoch", generation: 12 };
  await run(page, "setupRelational");
  const second = await context.newPage();
  await second.goto("/navegador");
  await load(second);
  const edit = (id: string, title: string): SQLiteTitleEdit => ({
    selection, taskId: "task", revision: 1, title,
    operation: { id, method: "PATCH", path: "/tasks/task", authoredAt: "2026-11-22T00:00:00Z", body: { title, revision: 1 } },
  });
  const firstEdit = edit("operation-1", "Edited in first tab");
  const secondEdit = edit("operation-2", "Edited in second tab");
  const results = await Promise.all([
    run(page, "commitRelationalTitle", firstEdit),
    run(second, "commitRelationalTitle", secondEdit),
  ]);
  expect(results).toContainEqual({ generation: 13, revision: 2 });
  expect(results).toContain("conflict");
  const winner = results[0] === "conflict" ? secondEdit : firstEdit;
  await (winner === firstEdit ? page : second).close();
  await (winner === firstEdit ? second : page).close();

  await context.setOffline(true);
  const reopened = await context.newPage();
  const response = await reopened.goto("/navegador");
  expect(response?.fromServiceWorker()).toBe(true);
  expect(await reopened.evaluate(() => crossOriginIsolated)).toBe(true);
  await load(reopened);
  const args = { selection: { ...selection, generation: 13 }, id: "task" };
  expect(await run(reopened, "readRelationalTask", args)).toMatchObject({ title: winner.title, revision: 2 });
  expect(await run(reopened, "commitRelationalTitle", winner)).toBe("duplicate");
  expect(await reopened.evaluate(() => fetch("/api/health/live").then(() => true, () => false))).toBe(false);
});

test("copies a v1 IndexedDB profile into an empty OPFS file and retains the source", async ({ page, context }) => {
  test.skip(mode !== "opfs" && mode !== "opfs-sahpool", "Requires an explicitly enabled proof build");
  const build = readFileSync(".next/BUILD_ID", "utf8").trim();
  const directory = `/_next/static/${build}/sqlite-proof`;
  const active = { spaceId: "account:active", epoch: "synthetic-epoch", generation: 99 };
  const taskId = "00000000-0000-4000-8000-000000000001";
  await page.goto("/api/health/live");
  await page.evaluate(async (taskId) => {
    const workspace = {
      preferences: { timezone: "America/Maceio", theme: "system", locale: "pt-BR" },
      projects: [{
        id: "inbox", revision: 7, isInbox: true,
        data: { name: "Inbox", archived: false, view: { layout: "list", sortMode: "manual", showCompleted: false } },
      }],
      tasks: [{
        id: taskId, projectId: "inbox", revision: 6, sectionId: null, parentId: null, occurrenceId: null,
        data: { title: "Legacy confirmed", description: "", position: 0, priority: 4, createdAt: "2026-11-22T00:00:00Z" },
      }],
      labels: [], taskLabels: [], sections: [], occurrences: [],
    };
    const replica = (id: string) => ({
      user: { id, email: `${id}@example.invalid` }, cursor: 400,
      confirmed: workspace,
      working: { ...workspace, tasks: [{
        ...workspace.tasks[0], revision: 7, data: { ...workspace.tasks[0].data, title: "Pending legacy title" },
      }] },
      pending: [{
        id: `operation-${id}`, method: "PATCH", path: "/tasks/" + taskId, authoredAt: "2026-11-22T00:00:00Z",
        body: { title: "Pending legacy title", revision: 6 }, generatedIds: ["stable-id"],
      }],
    });
    const selected = replica("active");
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("feito-browser", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("records");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("records", "readwrite", { durability: "strict" });
        const records = tx.objectStore("records");
        records.put({
          generation: 99, selection: { epoch: "synthetic-epoch", space: { kind: "account", user: selected.user }, discoverSession: false },
        }, "meta");
        records.put(selected, "account:active");
        records.put(replica("previous"), "account:previous");
        records.put({ workspace, imports: { import: { binding: "synthetic", result: { operationId: "import" } } } }, "local");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    await navigator.serviceWorker.register("/service-worker.js");
    await navigator.serviceWorker.ready;
  }, taskId);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const extract = () => page.evaluate(async (script) =>
    (await import(script)).readLegacyBrowserProfile(indexedDB, location.origin), `${directory}/legacy.mjs`);
  const source = await extract();
  expect(source.remotes).toHaveLength(2);
  expect(source.local.imports.import.binding).toBe("synthetic");
  const client = `${directory}/client.mjs?vfs=${mode}`;
  await page.evaluate(async (script) => { await import(script); }, client);
  expect(await run(page, "importLegacyProfile", source)).toBe(true);
  expect(await extract()).toEqual(source);
  await page.close();

  await context.setOffline(true);
  const reopened = await context.newPage();
  expect((await reopened.goto("/navegador"))?.fromServiceWorker()).toBe(true);
  await reopened.evaluate(async (script) => { await import(script); }, client);
  expect(await run(reopened, "readRelationalTask", { selection: active, id: taskId }))
    .toMatchObject({ revision: 7, title: "Pending legacy title" });
  expect(await run(reopened, "readRelationalQueue", active))
    .toMatchObject([{ id: "operation-active", sequence: 1, generated_ids: '["stable-id"]' }]);
  expect(await run(reopened, "taskDetail", { selection: active, id: taskId }))
    .toMatchObject({ status: 200, body: { revision: 7, title: "Pending legacy title" } });
  expect(await run(reopened, "editTitle", {
    selection: active, taskId, input: {
      id: "operation-offline", authoredAt: "2026-11-22T01:00:00Z", taskChanges: true,
      body: { title: "Edited offline", revision: 7 },
    },
  })).toMatchObject({ status: 200, body: { result: { revision: 8, title: "Edited offline" } } });
  expect(await run(reopened, "readRelationalQueue", { ...active, generation: 100 }))
    .toMatchObject([{ id: "operation-active", sequence: 1 }, { id: "operation-offline", sequence: 2 }]);
});
