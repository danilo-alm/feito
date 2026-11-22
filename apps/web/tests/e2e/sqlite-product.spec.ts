import { expect, test } from "@playwright/test";
import { row, test as signedIn } from "./fixtures";

test("opens the legacy workspace through the product UI and saves another task in SQLite only", async ({ page, context, isMobile }) => {
  const project = "00000000-0000-4000-8000-000000000011";
  const id = "00000000-0000-4000-8000-000000000012";
  await page.goto("/api/health/live");
  await page.evaluate(({ project, id }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("feito-browser", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("records");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("records", "readwrite");
      const records = tx.objectStore("records");
      records.put({
        generation: 11, selection: { epoch: "legacy", space: { kind: "local" }, discoverSession: false },
      }, "meta");
      records.put({ workspace: {
        preferences: { theme: "light", timezone: "America/Maceio", locale: "pt-BR" },
        projects: [{
          id: project, isInbox: true, revision: 1, data: {
            name: "Inbox", color: null, icon: "hash", archived: false, description: "",
            createdAt: "2026-11-22T00:00:00Z", view: { layout: "list", sortMode: "manual", showCompleted: false },
          },
        }],
        tasks: [{ id, projectId: project, revision: 1, sectionId: null, parentId: null, occurrenceId: null, data: {
          title: "Tarefa no IndexedDB", description: "", position: 0, priority: 4, createdAt: "2026-11-22T00:00:00Z",
          dueDate: null, dueTime: null, completedAt: null, recurrenceRule: null,
        } }],
        labels: [], sections: [], taskLabels: [], occurrences: [],
      } }, "local");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { project, id });
  await page.goto("/entrada");
  await expect(row(page, "Tarefa no IndexedDB")).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  if (isMobile) await page.locator("button[aria-label='Adicionar tarefa']").click();
  else await page.keyboard.press("q");
  const input = page.getByRole("dialog").getByLabel("Título da tarefa");
  await input.fill("Tarefa no SQLite");
  await input.press("Enter");
  await expect(row(page, "Tarefa no SQLite")).toHaveAttribute("data-task-id", /^[a-f0-9-]{36}$/);
  await page.reload();
  await expect(row(page, "Tarefa no SQLite")).toBeVisible();
  await expect(row(page, "Tarefa no IndexedDB")).toBeVisible();
  const generation = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("feito-browser", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const result = db.transaction("records").objectStore("records").get("meta");
      result.onsuccess = () => { db.close(); resolve(result.result.generation); };
      result.onerror = () => { db.close(); reject(result.error); };
    };
  }));
  expect(generation).toBe(11);
});

signedIn("downloads the selected account into SQLite without writing to the API", async ({ page, api }) => {
  const task = await api<{ id: string; revision: number }>("POST", "/tasks", { title: "Dados já sincronizados" });
  const { user } = await api<{ user: { id: string; email: string } }>("GET", "/auth/session");

  await page.goto("/api/health/live");
  await page.evaluate((user) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("feito-browser", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("records");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("records", "readwrite");
      tx.objectStore("records").put({
        generation: 4, selection: { epoch: "legacy-account", space: { kind: "account", user }, discoverSession: false },
      }, "meta");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), user);

  const writes: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/v1/") && request.method() !== "GET") writes.push(pathname);
  });
  await page.goto("/entrada");
  await expect(row(page, "Dados já sincronizados")).toBeVisible();
  await page.reload();
  await expect(row(page, "Dados já sincronizados")).toBeVisible();
  expect(writes).toEqual([]);
  expect(await api("GET", `/tasks/${task.id}`)).toMatchObject({
    id: task.id, title: "Dados já sincronizados", revision: task.revision,
  });
});
