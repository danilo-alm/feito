import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { handleLocal, newWorkspace } from "@feito/core/product/local-executor";
import type { Operation } from "@feito/core/product/replica";
import type { Session } from "@feito/core/types";
import { createBrowserWorkspace } from "../../src/browser/workspace";
import type { BrowserRecord, BrowserStorage, Selection, SpaceData } from "../../src/browser/storage";

const headers = { "Content-Type": "application/json" };
const init = (method: string, body?: unknown) => ({ method, headers, body: JSON.stringify(body) });
const accountA = { id: "f31dfa86-5de4-40e0-881c-ec0d72ba9fc3", email: "ana@feito.test" };
const accountB = { id: "395e9c59-e425-4554-872c-86d9dfcdaeca", email: "bea@feito.test" };

function memoryStorage() {
  let generation = 0;
  let selection: Selection = { epoch: "", space: { kind: "none" }, discoverSession: true };
  const records = new Map<string, SpaceData>();
  const key = () => selection.space.kind === "account" ? selection.space.user.id : selection.space.kind;
  let fail = false;
  const storage: BrowserStorage = {
    read: async () => structuredClone({ generation, selection, data: records.get(key()) } satisfies BrowserRecord),
    async commit(expected, update) {
      if (generation !== expected) return false;
      if (fail) {
        fail = false;
        throw new DOMException("Sem espaço", "QuotaExceededError");
      }
      selection = structuredClone(update.selection ?? selection);
      if (update.deleteAccount) records.delete(update.deleteAccount);
      if (update.data) records.set(key(), structuredClone(update.data));
      if (update.localIfMissing && !records.has("local")) records.set("local", structuredClone(update.localIfMissing));
      generation++;
      return true;
    },
  };
  return { storage, records, failNext: () => { fail = true; } };
}

function server() {
  const accounts = new Map([accountA, accountB].map(({ id }) => [id, { workspace: newWorkspace(), cursor: 0 }]));
  const appliedCounts = new Map<string, number>();
  let cookie: Session["user"] | undefined;
  let online = true;
  let lost = false;
  const applied = new Set<string>();
  const pushes: (Operation & { userId: string })[] = [];
  const pushGate = Promise.withResolvers<void>();
  const pushed = Promise.withResolvers<void>();
  let blockPush = false;
  let logouts = 0;
  return {
    pushes, appliedCounts, pushed: pushed.promise, release: pushGate.resolve,
    logouts: () => logouts,
    signIn: (user?: Session["user"]) => { cookie = user; },
    block: () => { blockPush = true; },
    offline: () => { online = false; },
    online: () => { online = true; },
    lose: () => { lost = true; },
    async network(url: string, request: RequestInit) {
      if (!online) throw new TypeError("Offline");
      if (url === "/api/v1/auth/login") {
        const { email } = JSON.parse(String(request.body)) as { email: string };
        cookie = email === accountA.email ? accountA : accountB;
        return Response.json({ user: cookie, mustChangePassword: false } satisfies Session);
      }
      if (url === "/api/v1/auth/logout") {
        logouts++;
        cookie = undefined;
        return new Response(null, { status: 204 });
      }
      if (!cookie) return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
      const user = cookie;
      const account = accounts.get(user.id)!;
      const expected = new Headers(request.headers).get("X-Feito-Account");
      if (expected && expected !== user.id) {
        return Response.json({ error: { code: "DESKTOP_ACCOUNT_CHANGED" } }, { status: 409 });
      }
      if (url === "/api/v1/auth/session") return Response.json({ user, mustChangePassword: false });
      if (request.method !== "POST") {
        const requested = new URL(url, "https://feito.test").searchParams.get("cursor");
        return Response.json({
          cursor: account.cursor,
          workspace: requested !== null && Number(requested) === account.cursor ? null : account.workspace,
          user,
        });
      }
      const operation = JSON.parse(String(request.body)) as Operation & { userId: string };
      expect(operation.userId).toBe(user.id);
      pushes.push(operation);
      pushed.resolve();
      if (blockPush) await pushGate.promise;
      if (!applied.has(operation.id)) {
        const mutation = await handleLocal(account.workspace, { ...operation, revision: account.cursor });
        expect(mutation.status).toBeLessThan(400);
        account.workspace = mutation.workspace;
        account.cursor++;
        appliedCounts.set(user.id, account.workspace.tasks.length);
        applied.add(operation.id);
      }
      if (lost) {
        lost = false;
        throw new TypeError("Resposta perdida");
      }
      return Response.json({ outcome: "applied" });
    },
  };
}

type Controller = ReturnType<typeof createBrowserWorkspace>;
const login = (client: Controller, email = accountA.email) => client.fetch("/api/v1/auth/login", init("POST", { email, password: "sintética" }));
const add = (client: Controller, title: string) => client.fetch("/api/v1/tasks", init("POST", { title }));
async function title(client: Controller, id: string) {
  const reply = await client.fetch("/api/v1/tasks/" + id, init("GET"));
  if (!reply.ok) return null;
  return (await reply.json() as { title: string }).title;
}

describe("espaços no navegador", () => {
  it("reabre o espaço local, repete commits concorrentes e não confirma falha de quota", async () => {
    const persisted = memoryStorage();
    const options = { storage: persisted.storage, network: vi.fn() };
    const first = createBrowserWorkspace(options);
    await first.openLocal();
    const second = createBrowserWorkspace(options);
    await second.refresh();

    const [one, two] = await Promise.all([add(first, "Compras"), add(second, "Cozinha")]);
    expect([one.status, two.status]).toEqual([201, 201]);
    const a = await one.json();
    const b = await two.json();

    persisted.failNext();
    expect((await add(second, "Descartado")).status).toBe(503);
    const reopened = createBrowserWorkspace(options);
    await reopened.refresh();
    expect(await title(reopened, a.id)).toBe("Compras");
    expect(await title(reopened, b.id)).toBe("Cozinha");
    const local = persisted.records.get("local");
    expect(local && "workspace" in local && local.workspace.tasks).toHaveLength(2);
    expect(options.network).not.toHaveBeenCalled();
  });

  it("retoma o mesmo ID e a mesma autoria depois de perder a resposta de uma gravação", async () => {
    const persisted = memoryStorage();
    const remote = server();
    const options = { storage: persisted.storage, network: remote.network };
    const first = createBrowserWorkspace(options);
    await first.refresh();
    expect((await login(first)).ok).toBe(true);
    await first.sync();

    remote.lose();
    const created = await add(first, "Ação offline");
    const { id } = await created.json();
    await first.sync();
    expect(first.getStatus()).toMatchObject({ pending: 1, sync: "error" });

    const reopened = createBrowserWorkspace(options);
    await reopened.refresh();
    expect(await title(reopened, id)).toBe("Ação offline");
    await reopened.sync();
    expect(reopened.getStatus()).toMatchObject({ pending: 0, sync: "current" });
    expect(remote.pushes).toHaveLength(2);
    expect(remote.pushes[0]).toEqual(remote.pushes[1]);
    expect(remote.appliedCounts.get(accountA.id)).toBe(1);
    expect(await title(reopened, id)).toBe("Ação offline");
  });

  it("preserva uma fila com sessão expirada e só a envia autenticada na conta de origem", async () => {
    const persisted = memoryStorage();
    const remote = server();
    const client = createBrowserWorkspace({ storage: persisted.storage, network: remote.network });
    await client.refresh();
    await login(client);
    await client.sync();
    remote.signIn();
    const task = await (await add(client, "Pendente da Ana")).json();
    await client.sync();
    expect(client.getStatus()).toMatchObject({ pending: 1, sync: "login" });

    await login(client, accountB.email);
    await client.sync();
    expect(await title(client, task.id)).toBeNull();
    expect(remote.pushes).toEqual([]);

    await login(client);
    await client.sync();
    expect(client.getStatus()).toMatchObject({ pending: 0, sync: "current" });
    expect(remote.pushes.map((operation) => operation.userId)).toEqual([accountA.id]);
    expect(remote.appliedCounts.get(accountB.id)).toBeUndefined();
    await login(client, accountB.email);
    await client.sync();
    expect(await title(client, task.id)).toBeNull();
  });

  it("sair offline apaga somente a conta, invalida abas e não aceita a confirmação tardia da fila", async () => {
    const persisted = memoryStorage();
    const remote = server();
    const options = { storage: persisted.storage, network: remote.network };
    const first = createBrowserWorkspace(options);
    const switched = vi.fn();
    const second = createBrowserWorkspace({ ...options, onSwitch: switched });
    await first.openLocal();
    const localTask = await (await add(first, "Guardada localmente")).json();
    await login(first);
    await first.sync();
    await second.refresh();
    switched.mockClear();

    remote.block();
    const accountTask = await (await add(first, "Pendente desta conta")).json();
    await remote.pushed;
    const { epoch } = second.getStatus();
    expect(await second.logout(false, epoch)).toEqual({ pending: 1 });
    expect(await title(second, accountTask.id)).toBe("Pendente desta conta");

    remote.offline();
    await second.logout(true, epoch);
    await first.refresh();
    expect(first.getStatus().space.kind).toBe("none");
    expect(switched).toHaveBeenCalledOnce();
    expect(persisted.records.has(accountA.id)).toBe(false);
    remote.release();
    await first.sync();
    expect(persisted.records.has(accountA.id)).toBe(false);

    const reopened = createBrowserWorkspace(options);
    await reopened.reconnect();
    expect(reopened.getStatus().space.kind).toBe("none");
    await reopened.openLocal();
    expect(await title(reopened, localTask.id)).toBe("Guardada localmente");
    remote.online();
    await reopened.reconnect();
    expect(remote.logouts()).toBe(1);
    expect(persisted.records.has(accountA.id)).toBe(false);
  });
  it("importa Todoist, exporta CSV e restaura o backup no espaço sem conta", async () => {
    const persisted = memoryStorage();
    const network = vi.fn();
    const client = createBrowserWorkspace({ storage: persisted.storage, network });
    await client.openLocal();
    const csv = readFileSync(new URL("../fixtures/todoist/casa-nova.csv", import.meta.url), "utf8");
    const body = new Blob([JSON.stringify({ files: [{ name: "casa-nova.csv", content: csv }] })], {
      type: "application/json",
    });
    const request = {
      method: "POST",
      headers: { ...headers, "X-Operation-Id": crypto.randomUUID() },
      body,
    };
    const preview = await client.fetch("/api/v1/import/sources/todoist/preview", request);
    expect(preview.ok).toBe(true);
    const { previewToken, counts } = await preview.json();
    expect(counts).toMatchObject({ projects: 1 });
    const confirm = { ...request, headers: { ...request.headers, "X-Preview-Token": previewToken } };
    const saved = await (await client.fetch("/api/v1/import/sources/todoist/confirm", confirm)).json();
    const replayed = await (await client.fetch("/api/v1/import/sources/todoist/confirm", confirm)).json();
    expect(saved.summary).toEqual(counts);
    expect(replayed).toEqual({ operationId: saved.operationId, summary: saved.summary });
    const exported = await client.fetch("/api/v1/projects/" + saved.projectIds[0] + "/export?format=todoist", init("GET"));
    expect(exported.headers.get("Content-Type")).toContain("text/csv");
    expect(await exported.text()).toContain("Ligar para a companhia de luz");

    const backup = await client.fetch("/api/v1/export", init("GET"));
    const restore = createBrowserWorkspace({ storage: memoryStorage().storage, network });
    await restore.openLocal();
    request.headers["X-Operation-Id"] = crypto.randomUUID();
    request.body = await backup.blob();
    const restoring = await (await restore.fetch("/api/v1/import/preview", request)).json();
    expect(restoring).toMatchObject({ destinationEmpty: true, counts: { projects: 2 } });
    const restored = await restore.fetch("/api/v1/import/confirm", {
      ...request, headers: { ...request.headers, "X-Preview-Token": restoring.previewToken },
    });
    expect(restored.ok).toBe(true);
    const imported = await (await restore.fetch("/api/v1/projects", init("GET"))).json();
    expect(imported.projects).toEqual(expect.arrayContaining([expect.objectContaining({ name: "casa-nova" })]));
    expect(network).not.toHaveBeenCalled();
  });

});
