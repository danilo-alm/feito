import { describe, expect, it, vi } from "vitest";
import type { Me, TaskComment, TaskComments, TaskDetail } from "@feito/core/types";
import type { Task } from "@feito/core/domain/product";
import { createDesktop, openFailure, type Bridge } from "./desktop";
import { handleLocal, newWorkspace, type LocalRequest } from "./local";

const origin = "https://feito.example";
const owner = { id: "b1fa8244-3300-4383-abb7-80fd5216a6fb", email: "feito@example.test" };
const alternate = { id: "ff7ca7e8-46ae-4f7d-aba0-6e6a27713090", email: "outra@example.test" };

function testBridge(serverOrigin = origin) {
  let stored: Awaited<ReturnType<Bridge["read"]>> = null;
  let workspace = newWorkspace();
  let cursor = 0;
  let connectedUser: typeof owner | undefined;
  let online = true;
  let loseNextResponse = false;
  const loginEmails: string[] = [];
  let blockedWrites = false;
  let rejectedTaskTitle: string | undefined;
  let incremental: { from: number; changes: unknown } | undefined;
  let incrementalPulls = 0;
  const attempts: Array<LocalRequest & { id: string }> = [];
  const receipts = new Map<string, string>();

  async function changeServer(request: LocalRequest) {
    const result = await handleLocal(workspace, request);
    expect(result.status).toBeLessThan(400);
    workspace = result.workspace;
    cursor++;
    return result.body as TaskDetail;
  }

  const bridge: Bridge = {
    async read() { return structuredClone(stored); },
    async write(generation, value) {
      expect(generation).toBe(stored?.generation ?? null);
      stored = structuredClone({ generation: (generation ?? 0) + 1, value });
      return structuredClone(stored);
    },
    async request(remoteOrigin, method, path, body) {
      expect(remoteOrigin).toBe(serverOrigin);
      if (!online) throw new Error("Sem internet");
      if (method === "POST" && path === "/api/v1/auth/login") {
        const { email } = body as { email: string };
        loginEmails.push(email);
        connectedUser = email === alternate.email ? alternate : owner;
        return { status: 200, body: { user: connectedUser, mustChangePassword: false } };
      }
      if (method === "POST" && path === "/api/v1/auth/logout") {
        connectedUser = undefined;
        return { status: 204, body: null };
      }
      if (!connectedUser) return { status: 401, body: null };
      const url = new URL(path, serverOrigin);
      expect(url.pathname).toBe("/api/v1/desktop-sync");
      if (method === "GET") {
        if (incremental && url.searchParams.get("incremental") === "1"
          && url.searchParams.get("cursor") === String(incremental.from)) {
          incrementalPulls++;
          return { status: 200, body: { user: connectedUser, cursor, workspace: null, changes: incremental.changes } };
        }
        return {
          status: 200,
          body: {
            user: connectedUser,
            cursor, workspace: url.searchParams.get("cursor") === String(cursor) ? null : structuredClone(workspace),
          },
        };
      }

      if (blockedWrites) throw new Error("Não foi possível enviar a operação.");
      const operation = body as LocalRequest & { id: string; userId?: string };
      expect(operation.userId).toBe(connectedUser.id);
      attempts.push(structuredClone(operation));
      if ((operation.body as { title?: string } | undefined)?.title === rejectedTaskTitle && rejectedTaskTitle) {
        return { status: 422, body: { error: { message: "Alteração rejeitada para o teste." } } };
      }
      if (receipts.has(operation.id)) {
        expect(JSON.stringify(operation)).toBe(receipts.get(operation.id));
      } else {
        await changeServer({ ...operation, replay: true });
        receipts.set(operation.id, JSON.stringify(operation));
      }
      if (loseNextResponse) {
        loseNextResponse = false;
        throw new Error("A resposta se perdeu depois da gravação.");
      }
      return { status: 200, body: { outcome: "applied" } };
    },
  };

  return {
    bridge, changeServer, attempts, receipts, loginEmails,
    setOnline: (value: boolean) => { online = value; },
    rejectTask: (title: string) => { rejectedTaskTitle = title; },
    setBlockedWrites: (value: boolean) => { blockedWrites = value; },
    incrementally: (changes: unknown) => { incremental = { from: cursor, changes }; },
    incrementalPulls: () => incrementalPulls,
    taskRecord: (id: string) => workspace.tasks.find((task) => task.id === id),
    loseResponse: () => { loseNextResponse = true; },
    expireSession: () => { connectedUser = undefined; },
    taskCount: () => workspace.tasks.length,
    comments: () => workspace.comments ?? [],
  };
}

function createTask(client: ReturnType<typeof createDesktop>, title: string) {
  return client.fetch("/api/v1/tasks", { method: "POST", body: JSON.stringify({ title }) });
}

function readTask(client: ReturnType<typeof createDesktop>, id: string) {
  return client.fetch(`/api/v1/tasks/${id}`, { method: "GET" });
}

describe("sincronização do desktop", () => {
  it("edita o endereço e substitui a conexão sem persistir a senha", async () => {
    const nextOrigin = "https://novo.feito.example";
    const old = testBridge();
    const next = testBridge(nextOrigin);
    const bridge: Bridge = { ...old.bridge, request: (address, method, path, body) =>
      (address === nextOrigin ? next.bridge : old.bridge).request(address, method, path, body) };
    const client = createDesktop(bridge, vi.fn());
    await client.connect(origin, owner.email, "senha anterior");
    await client.sync();
    next.setOnline(false);
    await expect(client.updateConnection(origin, nextOrigin, owner.email, "senha nova")).rejects.toThrow("Sem internet");
    expect(client.getStatus().servers).toHaveLength(1);
    expect(client.getStatus().server?.origin).toBe(origin);
    next.setOnline(true);
    await client.updateConnection(origin, nextOrigin, owner.email, "senha nova");
    await client.sync();
    expect(client.getStatus().servers).toEqual([expect.objectContaining({ origin: nextOrigin, email: owner.email })]);
    expect(JSON.stringify(await bridge.read())).not.toContain("senha nova");
    const reopened = createDesktop(bridge, vi.fn());
    await reopened.initialize();
    expect(reopened.getStatus().servers).toEqual([expect.objectContaining({ origin: nextOrigin })]);
  });

  it("edita as credenciais e isola a nova conta sem enviar a fila anterior", async () => {
    const server = testBridge();
    const switched = vi.fn();
    const client = createDesktop(server.bridge, vi.fn(), switched);
    await client.connect(origin, owner.email, "senha anterior");
    await client.sync();
    server.setOnline(false);
    const queued = await (await createTask(client, "Da conta anterior")).json() as TaskDetail;
    await client.sync();
    await expect(client.updateConnection(origin, "https://novo.feito.example", owner.email, "senha nova")).rejects.toThrow("pendentes");
    server.setOnline(true);
    await expect(client.updateConnection(origin, origin, alternate.email, "senha nova")).rejects.toThrow("pendentes");
    expect(client.getStatus().server).toMatchObject({ email: owner.email, pending: 1 });
    expect(server.attempts).toHaveLength(0);
    await client.updateConnection(origin, origin, owner.email, "senha nova");
    await client.sync();
    expect(server.taskRecord(queued.id)).toBeDefined();
    // A outra conta tem uma base distinta.
    const other = testBridge();
    const request = server.bridge.request;
    server.bridge.request = (address, method, path, body) =>
      other.bridge.request(address, method, path, body);
    await client.updateConnection(origin, origin, alternate.email, "senha nova");
    await client.sync();
    expect(client.getStatus().server).toMatchObject({ email: alternate.email, pending: 0 });
    expect((await readTask(client, queued.id)).status).toBe(404);
    expect(switched).toHaveBeenCalledTimes(2);
    server.bridge.request = request;
  });

  it("gerencia o link público na conta vinculada sem gravar no espaço ou na fila", async () => {
    const server = testBridge();
    const { id } = await server.changeServer({ method: "POST", path: "/projects", body: { name: "Viagem" } });
    const path = `/api/v1/projects/${id}/share`;
    const token = crypto.randomUUID();
    let sessionUser = owner;
    let shared = false;
    const request = server.bridge.request;
    const transport = vi.spyOn(server.bridge, "request").mockImplementation(async (remote, method, route, body) => {
      if (route === "/api/v1/auth/session") return { status: 200, body: { user: sessionUser, mustChangePassword: false } };
      if (route !== path) return request(remote, method, route, body);
      expect(remote).toBe(origin);
      expect(body).toBeUndefined();
      if (method === "DELETE") {
        shared = false;
        return { status: 204, body: null };
      }
      if (method === "PUT") shared = true;
      return { status: 200, body: { enabled: shared, token: shared ? token : null } };
    });
    const client = createDesktop(server.bridge, vi.fn());
    expect((await client.fetch(path, { method: "GET" })).status).toBe(422);
    expect(transport).not.toHaveBeenCalled();
    await client.connect(origin, owner.email, "senha de teste");
    await client.sync();
    const stored = await server.bridge.read();

    expect(await (await client.fetch(path, { method: "GET" })).json()).toEqual({ enabled: false, token: null });
    expect(await (await client.fetch(path, { method: "PUT" })).json()).toEqual({ enabled: true, token });
    expect(await (await client.fetch(path, { method: "GET" })).json()).toEqual({ enabled: true, token });
    expect((await client.fetch(path, { method: "DELETE" })).status).toBe(204);
    expect(await server.bridge.read()).toEqual(stored);
    expect(server.attempts).toHaveLength(0);

    sessionUser = alternate;
    transport.mockClear();
    expect((await client.fetch(path, { method: "PUT" })).status).toBe(401);
    expect(transport.mock.calls).toEqual([[origin, "GET", "/api/v1/auth/session"]]);
    expect(client.getStatus().sync).toBe("login");
  });

  it("permite trocar para o espaço local durante a consulta de compartilhamento", async () => {
    const server = testBridge();
    const { id } = await server.changeServer({ method: "POST", path: "/projects", body: { name: "Viagem" } });
    const client = createDesktop(server.bridge, vi.fn());
    await client.connect(origin, owner.email, "senha de teste");
    await client.sync();

    const requested = Promise.withResolvers<void>();
    const session = Promise.withResolvers<{ status: number; body: unknown }>();
    const request = server.bridge.request;
    const transport = vi.spyOn(server.bridge, "request").mockImplementation((...args) => {
      if (args[2] !== "/api/v1/auth/session") return request(...args);
      requested.resolve();
      return session.promise;
    });
    const reading = client.fetch(`/api/v1/projects/${id}/share`, { method: "GET" });
    await requested.promise;
    await client.switchSpace("local");
    expect(client.getStatus().active).toBe("local");
    session.resolve({ status: 200, body: { user: owner, mustChangePassword: false } });
    expect((await reading).status).toBe(409);
    expect(transport.mock.calls).toEqual([[origin, "GET", "/api/v1/auth/session"]]);
  });

  it("busca a revisão avisada durante uma leitura em andamento, apenas no espaço remoto ativo", async () => {
    const server = testBridge();
    const client = createDesktop(server.bridge, vi.fn());
    await client.connect(origin, owner.email, "senha de teste");
    await client.sync();

    const received = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const request = server.bridge.request;
    const spy = vi.spyOn(server.bridge, "request").mockImplementationOnce(async (...args) => {
      const snapshot = await request(...args);
      received.resolve();
      await resume.promise;
      return snapshot;
    });
    const pulling = client.sync();
    await received.promise;
    const task = await server.changeServer({ method: "POST", path: "/tasks", body: { title: "Atualizada por SSE" } });
    const notified = client.syncForRevision(origin, 1);
    resume.resolve();
    await Promise.all([pulling, notified]);
    expect((await readTask(client, task.id)).status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);

    await client.syncForRevision("https://other.example", 2);
    await client.syncForRevision(origin, 1);
    await client.switchSpace("local");
    await client.syncForRevision(origin, 2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("pede login ao reabrir sem sessão, reenvia a mesma operação e recebe uma edição do site", async () => {
    const server = testBridge();
    const first = createDesktop(server.bridge, vi.fn());
    await first.connect(origin, owner.email, "senha de teste");
    await first.sync();

    server.setOnline(false);
    const created = await createTask(first, "Criada sem conexão");
    expect(created.status).toBe(201);
    const task = await created.json() as TaskDetail;
    await first.sync();
    expect(first.getStatus()).toMatchObject({ sync: "offline", server: { pending: 1 } });
    expect(server.attempts).toHaveLength(0);

    server.expireSession();
    const onRemoteChange = vi.fn();
    const reopened = createDesktop(server.bridge, onRemoteChange);
    await reopened.initialize();
    expect(reopened.getStatus()).toMatchObject({ sync: "syncing", server: { pending: 1 } });
    expect(await (await readTask(reopened, task.id)).json()).toMatchObject({ title: task.title });

    server.setOnline(true);
    await reopened.sync();
    expect(reopened.getStatus()).toMatchObject({ sync: "login", server: { pending: 1 } });
    expect(server.attempts).toHaveLength(0);
    server.loseResponse();
    await reopened.connect(origin, owner.email, "senha de teste");
    await reopened.sync();
    expect(server.taskCount()).toBe(1);
    expect(reopened.getStatus().server?.pending).toBe(1);

    await reopened.sync();
    expect(reopened.getStatus()).toMatchObject({ sync: "current", server: { pending: 0 } });
    expect(server.attempts).toHaveLength(2);
    expect(server.receipts.size).toBe(1);
    expect(server.taskCount()).toBe(1);

    await server.changeServer({
      method: "PATCH", path: `/tasks/${task.id}`, body: { revision: 1, title: "Alterada no site" },
    });
    await reopened.sync();
    expect(await (await readTask(reopened, task.id)).json()).toMatchObject({ title: "Alterada no site" });
    expect(onRemoteChange).toHaveBeenCalled();
  });

  it("comenta offline, envia os comentários na fila e recebe os do site", async () => {
    const server = testBridge();
    const client = createDesktop(server.bridge, vi.fn());
    await client.connect(origin, owner.email, "senha de teste");
    const task = await (await createTask(client, "Comentada")).json() as TaskDetail;
    await client.sync();

    server.setOnline(false);
    await client.sync();
    const queued = client.getStatus().server?.pending ?? 0;
    const comment = (path: string, method: string, body?: unknown) =>
      client.fetch(`/api/v1${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const created = await comment(`/tasks/${task.id}/comments`, "POST", { body: "Sem conexão" });
    expect(created.status).toBe(201);
    const local = await created.json() as TaskComment;
    expect((await comment(`/comments/${local.id}`, "PATCH", { revision: 1, body: "Editado sem conexão" })).status).toBe(200);
    await client.sync();
    expect(client.getStatus()).toMatchObject({ server: { pending: queued + 2 } });
    expect(await (await readTask(client, task.id)).json()).toMatchObject({ commentCount: 1 });

    server.setOnline(true);
    await client.sync();
    expect(client.getStatus()).toMatchObject({ sync: "current", server: { pending: 0 } });
    expect(server.comments()).toMatchObject([{ id: local.id, revision: 2, data: { body: "Editado sem conexão" } }]);

    await server.changeServer({ method: "POST", path: `/tasks/${task.id}/comments`, body: { body: "Do site" } });
    await client.sync();
    const listed = await (await comment(`/tasks/${task.id}/comments`, "GET")).json() as TaskComments;
    expect(listed.comments.map(({ body }) => body)).toEqual(["Editado sem conexão", "Do site"]);
  });

  it("retoma a sessão guardada e envia a fila quando o desktop volta a ficar online", async () => {
    const server = testBridge();
    const first = createDesktop(server.bridge, vi.fn());
    await first.connect(origin, owner.email, "senha de teste");
    await first.sync();

    server.setOnline(false);
    const response = await createTask(first, "Pendência retomada após reinício");
    expect(response.status).toBe(201);
    const task = await response.json() as TaskDetail;
    await first.sync();

    // A ponte simula o cookie recuperado pelo Rust após reiniciar o processo.
    const reopened = createDesktop(server.bridge, vi.fn());
    await reopened.initialize();
    expect(reopened.getStatus()).toMatchObject({ sync: "syncing", server: { pending: 1 } });
    await reopened.sync();
    expect(reopened.getStatus()).toMatchObject({ sync: "offline", server: { pending: 1 } });
    expect(await (await readTask(reopened, task.id)).json()).toMatchObject({ title: task.title });

    server.setOnline(true);
    await reopened.sync();
    expect(reopened.getStatus()).toMatchObject({ sync: "current", server: { pending: 0 } });
    expect(server.loginEmails).toEqual([owner.email]);
    expect(server.receipts.size).toBe(1);
    expect(server.taskCount()).toBe(1);
  });

  it("reenvia uma conclusão recorrente e mantém a edição dependente na sequência", async () => {
    const server = testBridge();
    const client = createDesktop(server.bridge, vi.fn());
    await client.connect(origin, owner.email, "senha de teste");
    await client.sync();
    const task = await server.changeServer({
      method: "POST", path: "/tasks", body: {
        title: "Regar plantas", recurrence: { frequency: "daily" }, dueDate: "2026-11-12",
      },
    });
    await client.sync();
    server.setOnline(false);
    const response = await client.fetch(`/api/v1/tasks/${task.id}/complete`, {
      method: "POST", body: JSON.stringify({ revision: task.revision, occurrenceId: task.occurrenceId }),
    });
    expect(response.status).toBe(200);
    const advanced = await (await readTask(client, task.id)).json() as TaskDetail;
    expect(advanced.occurrenceId).not.toBe(task.occurrenceId);
    const edit = await client.fetch(`/api/v1/tasks/${task.id}`, {
      method: "PATCH", body: JSON.stringify({ revision: advanced.revision, title: "Regar as plantas" }),
    });
    expect(edit.status).toBe(200);
    await client.sync();

    server.setOnline(true);
    server.loseResponse();
    await client.sync();
    expect(client.getStatus().server?.pending).toBe(2);
    expect(server.taskRecord(task.id)?.occurrenceId).toBe(advanced.occurrenceId);
    await client.sync();
    expect(client.getStatus()).toMatchObject({ sync: "current", server: { pending: 0 } });
    expect(server.attempts[0]).toEqual(server.attempts[1]);
    expect(server.attempts.map(({ method }) => method)).toEqual(["POST", "POST", "PATCH"]);
    expect(server.receipts.size).toBe(2);
    expect(server.taskCount()).toBe(1);
    expect(server.taskRecord(task.id)).toMatchObject({
      occurrenceId: advanced.occurrenceId, data: { dueDate: advanced.dueDate, title: "Regar as plantas" },
    });
  });

  it("aplica edições e exclusões incrementais sem descartar a tarefa pendente", async () => {
    const server = testBridge();
    const createOnServer = (title: string) => server.changeServer({ method: "POST", path: "/tasks", body: { title } });
    const edited = await createOnServer("A editar no site");
    const removed = await createOnServer("A excluir no site");
    const untouched = await createOnServer("Tarefa que já estava no desktop");
    const client = createDesktop(server.bridge, vi.fn());
    const local = await (await createTask(client, "Tarefa do espaço local")).json() as TaskDetail;
    await client.connect(origin, owner.email, "senha de teste");
    await client.sync();

    server.setOnline(false);
    const pending = await (await createTask(client, "Ainda por enviar")).json() as TaskDetail;
    await client.sync();

    const changes: { tasks: { upsert: Task[]; remove: string[] } } = {
      tasks: { upsert: [], remove: [removed.id] },
    };
    server.incrementally(changes);
    await server.changeServer({
      method: "PATCH", path: `/tasks/${edited.id}`, body: { title: "Editada no site", revision: edited.revision },
    });
    changes.tasks.upsert.push(server.taskRecord(edited.id)!);
    await server.changeServer({ method: "DELETE", path: `/tasks/${removed.id}?revision=${removed.revision}` });

    server.setOnline(true);
    server.setBlockedWrites(true);
    await client.sync();
    expect(server.incrementalPulls()).toBe(1);
    expect(client.getStatus().server?.pending).toBe(1);
    expect(await (await readTask(client, edited.id)).json()).toMatchObject({ title: "Editada no site" });
    expect((await readTask(client, removed.id)).status).toBe(404);
    expect((await readTask(client, untouched.id)).status).toBe(200);
    expect((await readTask(client, pending.id)).status).toBe(200);

    server.setBlockedWrites(false);
    await client.sync();
    expect(client.getStatus()).toMatchObject({ sync: "current", server: { pending: 0 } });
    expect(server.taskCount()).toBe(3);
    await client.switchSpace("local");
    expect((await readTask(client, local.id)).status).toBe(200);
  });

  it("confirma o prefixo da fila e permite descartar uma operação rejeitada", async () => {
    const server = testBridge();
    const client = createDesktop(server.bridge, vi.fn());
    await client.connect(origin, owner.email, "senha de teste");
    await client.sync();
    server.setOnline(false);
    await createTask(client, "Aceita antes da rejeição");
    const denied = await (await createTask(client, "Rejeitada pelo servidor")).json() as TaskDetail;
    const pending = await (await createTask(client, "Enviada após descarte")).json() as TaskDetail;
    await client.sync();

    server.rejectTask(denied.title);
    server.setOnline(true);
    await client.sync();
    const status = client.getStatus();
    expect(status).toMatchObject({ sync: "error", server: { pending: 2 }, blocked: expect.any(String) });
    expect(server.taskCount()).toBe(1);
    expect((await readTask(client, denied.id)).status).toBe(200);

    await client.discardRejected(status.blocked!);
    await client.sync();
    expect(client.getStatus()).toMatchObject({ sync: "current", server: { pending: 0 } });
    expect((await readTask(client, denied.id)).status).toBe(404);
    expect(server.taskRecord(pending.id)).toBeDefined();
  });

  it("troca a URL sem enviar nem perder a fila vinculada ao endereço anterior", async () => {
    const nextOrigin = "https://outro.feito.example";
    const old = testBridge();
    const next = testBridge(nextOrigin);
    const bridge = {
      ...old.bridge,
      request: (address: string, method: string, path: string, body?: unknown) =>
        (address === nextOrigin ? next.bridge : old.bridge).request(address, method, path, body),
    };

    const onWorkspaceSwitch = vi.fn();
    const client = createDesktop(bridge, vi.fn(), onWorkspaceSwitch);
    const local = await (await createTask(client, "Tarefa somente local")).json() as TaskDetail;
    await client.connect(origin, owner.email, "senha de teste");
    await client.sync();
    old.setOnline(false);
    const queued = await (await createTask(client, "Pendente no endereço anterior")).json() as TaskDetail;
    await client.sync();

    next.setOnline(false);
    await expect(client.connect(nextOrigin, owner.email, "senha de teste")).rejects.toThrow("Sem internet");
    expect(client.getStatus().server).toMatchObject({ origin, pending: 1 });
    next.setOnline(true);
    await client.connect(nextOrigin, owner.email, "senha de teste");
    await client.sync();
    expect(client.getStatus().server).toMatchObject({ origin: nextOrigin, pending: 0 });
    expect(onWorkspaceSwitch).toHaveBeenCalledTimes(2);
    expect(next.attempts).toHaveLength(0);
    expect((await readTask(client, queued.id)).status).toBe(404);

    const reopened = createDesktop(bridge, vi.fn());
    await reopened.initialize();
    await reopened.switchSpace("local");
    expect((await readTask(reopened, local.id)).status).toBe(200);

    await reopened.openServer(origin);
    await reopened.sync();
    expect(reopened.getStatus().server).toMatchObject({ origin, pending: 1 });
    expect((await readTask(reopened, queued.id)).status).toBe(200);
    old.setOnline(true);
    await reopened.sync();
    expect(reopened.getStatus().server).toMatchObject({ origin, pending: 0 });
    expect(old.taskRecord(queued.id)).toBeDefined();
    expect(old.attempts).toHaveLength(1);
    expect(next.attempts).toHaveLength(0);
  });

  it("exclui apenas o espaço local e permite conectar ou criar um novo", async () => {
    const server = testBridge();
    const client = createDesktop(server.bridge, vi.fn());
    const deleted = await (await createTask(client, "Tarefa do espaço excluído")).json() as TaskDetail;
    await client.deleteLocal();
    expect(client.getStatus()).toMatchObject({ active: "none", hasLocal: false });
    expect((await readTask(client, deleted.id)).status).toBe(404);
    expect(server.loginEmails).toHaveLength(0);

    const reopened = createDesktop(server.bridge, vi.fn());
    await reopened.initialize();
    expect(reopened.getStatus()).toMatchObject({ active: "none", hasLocal: false });
    await reopened.connect(origin, owner.email, "senha de teste");
    await reopened.sync();
    expect(reopened.getStatus()).toMatchObject({ active: "server", hasLocal: false });
    await reopened.createLocal();
    expect(reopened.getStatus()).toMatchObject({ active: "local", hasLocal: true });
    expect((await readTask(reopened, deleted.id)).status).toBe(404);

    await reopened.openServer(origin);
    await reopened.sync();
    server.setOnline(false);
    const queued = await (await createTask(reopened, "Pendente no servidor")).json() as TaskDetail;
    await reopened.sync();
    await reopened.deleteLocal();
    expect(reopened.getStatus()).toMatchObject({ active: "server", hasLocal: false, server: { pending: 1 } });
    expect((await readTask(reopened, queued.id)).status).toBe(200);
  });

  it("isola o espaço local e mantém a fila se a sessão expirar ou a conta mudar", async () => {
    const server = testBridge();
    const client = createDesktop(server.bridge, vi.fn());
    const local = await (await createTask(client, "Somente neste computador")).json() as TaskDetail;
    await client.connect(origin, owner.email, "senha de teste");
    await client.sync();
    expect((await readTask(client, local.id)).status).toBe(404);
    expect(await (await client.fetch("/api/v1/me", { method: "GET" })).json() as Me).toMatchObject({ user: owner });

    server.expireSession();
    expect((await createTask(client, "Na fila da conta original")).status).toBe(201);
    await client.sync();
    expect(client.getStatus()).toMatchObject({ sync: "login", server: { pending: 1, email: owner.email } });

    await expect(client.connect(origin, alternate.email, "senha de teste")).rejects.toThrow("mesma conta");
    expect(client.getStatus()).toMatchObject({ sync: "login", server: { pending: 1, email: owner.email } });
    expect(server.taskCount()).toBe(0);

    await client.switchSpace("local");
    expect((await readTask(client, local.id)).status).toBe(200);
    expect(client.getStatus().sync).toBe("local");

    await client.connect(origin, owner.email, "senha de teste");
    await client.sync();
    expect(client.getStatus()).toMatchObject({ sync: "current", server: { pending: 0 } });
    expect(server.taskCount()).toBe(1);
  });
});

it("mantém o idioma na reabertura offline e o envia com a fila do espaço remoto", async () => {
  const server = testBridge();
  const client = createDesktop(server.bridge, vi.fn());
  await client.connect(origin, owner.email, "senha sintética");
  await client.sync();
  server.setOnline(false);
  const response = await client.fetch("/api/v1/preferences", { method: "PATCH", body: JSON.stringify({ locale: "en" }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ locale: "en" });
  const reopened = createDesktop(server.bridge, vi.fn());
  await reopened.initialize();
  const me = await (await reopened.fetch("/api/v1/me", { method: "GET" })).json() as Me;
  expect(me.preferences.locale).toBe("en");
  server.setOnline(true);
  await reopened.sync();
  expect(reopened.getStatus().server?.pending).toBe(0);
  expect(server.attempts).toContainEqual(expect.objectContaining({ path: "/preferences", body: { locale: "en" } }));
  const saved = await server.bridge.read();
  expect(saved?.value.server?.confirmed?.preferences.locale).toBe("en");
});

it("commits a title through the bounded native command before publishing the updated task", async () => {
  const workspace = newWorkspace();
  const created = await handleLocal(workspace, { method: "POST", path: "/tasks", body: { title: "Antes" } });
  const task = created.body as TaskDetail;
  const existing = { generation: 5, value: {
    version: 1 as const, active: "local" as const, local: created.workspace,
  } };
  const confirmation = Promise.withResolvers<number>();
  const arrived = Promise.withResolvers<void>();
  const writeTitle = vi.fn(async () => {
    arrived.resolve();
    return confirmation.promise;
  });
  const write = vi.fn<Bridge["write"]>();
  const client = createDesktop({
    read: async () => existing, write, writeTitle,
    request: async () => { throw new Error("Offline"); },
  }, vi.fn());
  await client.initialize();
  const change = client.fetch(`/api/v1/tasks/${task.id}`, {
    method: "PATCH", body: JSON.stringify({ revision: task.revision, title: "Depois" }),
  });
  await arrived.promise;
  expect(write).not.toHaveBeenCalled();
  expect(writeTitle).toHaveBeenCalledWith({
    selection: { spaceId: workspace.projects[0].id, generation: 5, epoch: "" },
    taskId: task.id, revision: task.revision, title: "Depois", operation: undefined,
  });
  confirmation.resolve(6);
  const reply = await change;
  expect(await reply.json()).toMatchObject({ title: "Depois", revision: task.revision + 1 });
  expect(await (await readTask(client, task.id)).json()).toMatchObject({ title: "Depois" });
});

describe("dados locais que não abrem", () => {
  const missingKey = { code: "key-missing", message: "A chave do Feito não foi encontrada no cofre do sistema." };

  function brokenBridge(failure: { code: string; message: string }) {
    const healthy = testBridge().bridge;
    let broken = true;
    const reset = vi.fn(async () => { broken = false; });
    const bridge: Bridge = {
      ...healthy,
      async read() {
        if (broken) throw failure;
        return healthy.read();
      },
      reset,
    };
    return { bridge, reset, repair: () => { broken = false; } };
  }

  it("começa do zero com um espaço local novo depois de perder a chave", async () => {
    const { bridge, reset } = brokenBridge(missingKey);
    const client = createDesktop(bridge, vi.fn());
    await expect(client.initialize()).rejects.toBe(missingKey);
    expect(client.getStatus().ready).toBe(false);
    expect(reset).not.toHaveBeenCalled();
    await client.startOver();
    expect(reset).toHaveBeenCalledOnce();
    expect(client.getStatus()).toMatchObject({ ready: true, active: "local", hasLocal: true, servers: [] });
  });

  it("não separa dados que já voltaram a abrir", async () => {
    const { bridge, reset, repair } = brokenBridge(missingKey);
    const client = createDesktop(bridge, vi.fn());
    await expect(client.initialize()).rejects.toBe(missingKey);
    repair();
    await client.initialize();
    await client.startOver();
    expect(reset).not.toHaveBeenCalled();
  });

  it("mantém a tela de erro quando o armazenamento recusa começar do zero", async () => {
    const refusal = { code: "vault-unavailable", message: "Não foi possível acessar a chave do Feito no cofre do sistema." };
    const { bridge, reset } = brokenBridge(missingKey);
    reset.mockRejectedValueOnce(refusal);
    const write = vi.spyOn(bridge, "write");
    const client = createDesktop(bridge, vi.fn());
    await expect(client.startOver()).rejects.toBe(refusal);
    expect(write).not.toHaveBeenCalled();
    expect(client.getStatus().ready).toBe(false);
  });

  it("identifica o motivo informado pelo armazenamento", async () => {
    for (const code of ["key-missing", "vault-unavailable", "unreadable", "newer-version", "storage"]) {
      expect(openFailure({ code })).toBe(code);
    }
    for (const unknown of [new Error("falha"), "falha", { code: "outro" }, null, undefined]) {
      expect(openFailure(unknown)).toBe("storage");
    }
    const bridge: Bridge = {
      ...testBridge().bridge,
      read: async () => ({ generation: 1, value: { version: 2 as 1, active: "none" } }),
    };
    const failure = await createDesktop(bridge, vi.fn()).initialize().catch(openFailure);
    expect(failure).toBe("newer-version");
  });
});
