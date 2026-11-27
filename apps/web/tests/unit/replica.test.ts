import { describe, expect, it, vi } from "vitest";
import { handleLocal, newWorkspace, type Workspace } from "@feito/core/product/local-executor";
import {
  canSync, downloadReplica, queueOperation, reconcileReplica, ReplicaSyncError, synchronizeReplica,
  type Operation, type Replica, type SyncReply, type SyncRequest,
} from "@feito/core/product/replica";

const user = { id: "395e9c59-e425-4554-872c-86d9dfcdaeca", email: "ana@feito.test" };
const other = { id: "f31dfa86-5de4-40e0-881c-ec0d72ba9fc3", email: "bea@feito.test" };
const authoredAt = "2026-03-10T12:00:00Z";
const ok = (body: unknown): SyncReply => ({ status: 200, body });
const snapshot = (workspace: Workspace | null, cursor = 1, who = user, changes?: unknown) =>
  ({ cursor, workspace, user: who, ...(changes ? { changes } : {}) });

function replica(overrides: Partial<Replica> = {}): Replica {
  const workspace = newWorkspace();
  return { user, cursor: 1, confirmed: workspace, working: workspace, pending: [], ...overrides };
}

async function queued(base: Replica, path: string, body: unknown, method = "POST") {
  const request = { method, path, body, authoredAt, id: crypto.randomUUID() };
  const result = await handleLocal(base.working, request);
  expect(result.status).toBeLessThan(400);
  return queueOperation(base, request, result);
}

const rejects = (promise: Promise<unknown>) => promise.then(() => { throw new Error("esperava falha"); }, (error) => error);

describe("canSync", () => {
  it("aceita somente as operações de escrita sincronizáveis", () => {
    const yes: [string, string][] = [
      ["PATCH", "/preferences"], ["POST", "/tasks"], ["POST", "/projects"], ["POST", "/labels"],
      ["PATCH", "/tasks/a"], ["DELETE", "/projects/a?revision=2"], ["PATCH", "/sections/a"], ["DELETE", "/labels/a"],
      ["POST", "/tasks/a/complete"], ["POST", "/tasks/a/duplicate"], ["PUT", "/tasks/a/recurrence"],
      ["DELETE", "/tasks/a/recurrence"], ["POST", "/projects/a/archive"], ["POST", "/projects/a/sections"],
      ["POST", "/sections/a/move"], ["PATCH", "/projects/a/view"], ["POST", "/projects/a/move"], ["POST", "/labels/a/move"],
      ["POST", "/tasks/a/comments"], ["PATCH", "/comments/a"], ["DELETE", "/comments/a?revision=1"],
    ];
    const no: [string, string][] = [
      ["GET", "/tasks"], ["POST", "/sections"], ["POST", "/tasks/a/outra"], ["PUT", "/tasks/a"],
      ["POST", "/search"], ["PATCH", "/tasks/a/b/c"], ["POST", "/labels/a/outra"], ["DELETE", "/preferences"],
      ["GET", "/tasks/a/comments"], ["POST", "/comments"], ["POST", "/comments/a"], ["PATCH", "/tasks/a/comments"],
    ];
    for (const [method, path] of yes) expect(canSync(method, path), `${method} ${path}`).toBe(true);
    for (const [method, path] of no) expect(canSync(method, path), `${method} ${path}`).toBe(false);
  });
});

describe("queueOperation", () => {
  it("enfileira a operação com o corpo e os IDs gerados pelo executor", async () => {
    const next = await queued(replica(), "/tasks", { title: "Comprar pão" });
    expect(next.pending).toHaveLength(1);
    expect(next.pending[0]).toMatchObject({
      method: "POST", path: "/tasks", authoredAt, body: { title: "Comprar pão", id: expect.any(String) },
      generatedIds: [expect.any(String)],
    });
    expect(next.working.tasks).toHaveLength(1);
    expect(next.confirmed.tasks).toHaveLength(0);

    const result = await handleLocal(next.working, { method: "PATCH", path: "/preferences", body: { theme: "dark" }, authoredAt });
    const generated = queueOperation(next, { method: "PATCH", path: "/preferences", authoredAt }, { ...result, operationBody: undefined });
    expect(generated.pending[1].id).toEqual(expect.any(String));
    expect(generated.pending[1].body).toBeUndefined();
  });
});

describe("downloadReplica", () => {
  it("baixa a primeira cópia dos dados", async () => {
    const workspace = newWorkspace();
    const request = vi.fn<SyncRequest>(async () => ok(snapshot(workspace, 4)));
    const downloaded = await downloadReplica(request);
    expect(downloaded).toMatchObject({ user, cursor: 4, pending: [], confirmed: workspace, working: workspace });
    expect(request).toHaveBeenCalledWith("GET", "/api/v1/desktop-sync");
    await expect(downloadReplica(request, user.id)).resolves.toMatchObject({ cursor: 4 });
  });

  it("exige a conta vinculada ao espaço", async () => {
    const error = await rejects(downloadReplica(async () => ok(snapshot(newWorkspace(), 1, other)), user.id));
    expect(error).toBeInstanceOf(ReplicaSyncError);
    expect(error).toMatchObject({ state: "login", identityChanged: true, blocked: undefined });
  });

  it("pede novo login quando a sessão expirou ou a conta mudou", async () => {
    for (const status of [401, 403]) {
      expect(await rejects(downloadReplica(async () => ({ status, body: null }))))
        .toMatchObject({ state: "login", identityChanged: false });
    }
    const changed = { status: 409, body: { error: { code: "DESKTOP_ACCOUNT_CHANGED" } } };
    expect(await rejects(downloadReplica(async () => changed))).toMatchObject({ state: "login", identityChanged: true });
  });

  it("recusa respostas incompatíveis, com a mensagem do servidor quando existe", async () => {
    const workspace = newWorkspace();
    const invalid: SyncReply[] = [
      { status: 500, body: { error: { message: "Falha no servidor." } } },
      { status: 200, body: null },
      ok({ ...snapshot(workspace), cursor: -1 }),
      ok({ ...snapshot(workspace), cursor: 1.5 }),
      ok({ ...snapshot(workspace), user: { id: 1, email: "x" } }),
      ok({ ...snapshot(workspace), user: { id: "x", email: 1 } }),
      ok(snapshot({ ...workspace, tasks: "x" } as never)),
      ok(snapshot(workspace, 1, user, {})),
      ok({ ...snapshot(null), changes: [] }),
      ok({ ...snapshot(null), changes: "x" }),
    ];
    for (const reply of invalid) {
      const error = await rejects(downloadReplica(async () => reply));
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ReplicaSyncError);
    }
    expect((await rejects(downloadReplica(async () => invalid[0]))).message).toBe("Falha no servidor.");
    expect((await rejects(downloadReplica(async () => invalid[1]))).message).toBe(
      "O servidor não oferece uma API de sincronização compatível.",
    );
    expect((await rejects(downloadReplica(async () => ok(snapshot(null))))).message)
      .toBe("O servidor não devolveu a primeira cópia dos dados.");
  });
});

describe("reconcileReplica", () => {
  it("mantém a cópia quando nada mudou", async () => {
    const base = replica();
    expect(await reconcileReplica(base, {})).toBe(base);
    expect(await reconcileReplica(base, { remote: snapshot(null, 1) })).toBe(base);
    expect(await reconcileReplica(base, { remote: snapshot(null, 1), fromCursor: 1 })).toBe(base);
  });

  it("recusa respostas de outra conta e cópias incompletas", async () => {
    const base = replica();
    expect(await rejects(reconcileReplica(base, { remote: snapshot(null, 1, other) })))
      .toMatchObject({ state: "login", identityChanged: true });
    await expect(reconcileReplica(base, { remote: snapshot(null, 2) })).rejects.toThrow("cópia incompleta");
  });

  it("substitui a cópia confirmada e reaplica as operações pendentes", async () => {
    const pending = await queued(replica(), "/tasks", { title: "Pendente" });
    const remote = newWorkspace();
    const next = await reconcileReplica(pending, { remote: snapshot(remote, 5), notice: "Aviso" });
    expect(next).toMatchObject({ cursor: 5, confirmed: remote, notice: "Aviso" });
    expect(next.working.tasks.map((task) => task.data.title)).toEqual(["Pendente"]);

    const kept = await reconcileReplica(next, { remote: snapshot(remote, 6, { ...user, email: "novo@feito.test" }) });
    expect(kept).toMatchObject({ cursor: 6, notice: "Aviso", user: { email: "novo@feito.test" } });
  });

  it("descarta as operações confirmadas e ignora as que deixaram de se aplicar", async () => {
    const first = await queued(replica(), "/tasks", { title: "Primeira" });
    const second = await queued(first, "/tasks", { title: "Segunda" });
    const done = await reconcileReplica(second, { removed: new Set([first.pending[0].id]) });
    expect(done.pending.map((operation) => operation.id)).toEqual([second.pending[1].id]);
    expect(done.working.tasks.map((task) => task.data.title)).toEqual(["Segunda"]);

    const broken: Replica = {
      ...second, pending: [...second.pending, { id: "x", method: "PATCH", path: `/tasks/${user.id}`, authoredAt, body: { revision: 1, title: "x" } }],
    };
    const replayed = await reconcileReplica(broken, { remote: snapshot(newWorkspace(), 2) });
    expect(replayed.working.tasks).toHaveLength(2);
  });

  it("aplica atualizações incrementais por tabela", async () => {
    const withData = await queued(await queued(replica(), "/tasks", { title: "Fica" }), "/labels", { name: "casa" });
    const confirmed = withData.working;
    const [task] = confirmed.tasks;
    const [label] = confirmed.labels;
    const base = replica({ confirmed, working: confirmed });
    const projects = { upsert: [{ ...confirmed.projects[0], revision: 9 }], remove: [] };
    const changes = {
      preferences: { ...confirmed.preferences, theme: "dark" as const },
      projects,
      sections: { upsert: [], remove: [] },
      tasks: { upsert: [{ ...task, revision: 3 }, { ...task, id: user.id }], remove: [] },
      labels: { upsert: [], remove: [label.id] },
      taskLabels: [[task.id, [label.id]], [user.id, []]],
      occurrences: [[task.id, []]],
    };
    const next = await reconcileReplica(base, { remote: snapshot(null, 2, user, changes), fromCursor: 1 });
    expect(next.cursor).toBe(2);
    expect(next.confirmed.projects[0].revision).toBe(9);
    expect(next.confirmed.preferences.theme).toBe("dark");
    expect(next.confirmed.tasks.map((item) => item.revision)).toEqual([3, 1]);
    expect(next.confirmed.labels).toEqual([]);
    expect(next.confirmed.taskLabels).toEqual([[task.id, [label.id]]]);

    const removal = await reconcileReplica(next, {
      remote: snapshot(null, 3, user, { tasks: { upsert: [], remove: [task.id] }, occurrences: [[task.id, []]] }),
      fromCursor: 2,
    });
    expect(removal.confirmed.tasks.map((item) => item.id)).toEqual([user.id]);
    expect(removal.confirmed.taskLabels).toEqual([]);
  });

  it("aplica comentários incrementais e descarta os da tarefa removida", async () => {
    const withTask = await queued(replica(), "/tasks", { title: "Comentada" });
    const [task] = withTask.working.tasks;
    const withComment = await queued(withTask, `/tasks/${task.id}/comments`, { body: "Primeiro" });
    const confirmed = withComment.working;
    const [comment] = confirmed.comments!;
    const base = replica({ confirmed, working: confirmed });
    const edited = { ...comment, revision: 2, data: { ...comment.data, body: "Editado" } };
    const added = { ...comment, id: user.id, data: { ...comment.data, body: "Do servidor" } };
    const next = await reconcileReplica(base, {
      remote: snapshot(null, 2, user, { comments: { upsert: [edited, added], remove: [] } }), fromCursor: 1,
    });
    expect(next.confirmed.comments!.map(({ data }) => data.body)).toEqual(["Editado", "Do servidor"]);
    const removed = await reconcileReplica(next, {
      remote: snapshot(null, 3, user, { comments: { upsert: [], remove: [user.id] } }), fromCursor: 2,
    });
    expect(removed.confirmed.comments!.map(({ id }) => id)).toEqual([comment.id]);
    const deleted = await reconcileReplica(removed, {
      remote: snapshot(null, 4, user, { tasks: { upsert: [], remove: [task.id] } }), fromCursor: 3,
    });
    expect(deleted.confirmed.comments).toEqual([]);

    // Baselines from servers without comments keep the pending comment in the working copy.
    const { comments: _comments, ...legacy } = withTask.working;
    const pending = await reconcileReplica(withComment, { remote: snapshot(legacy, 5) });
    expect(pending.confirmed.comments).toBeUndefined();
    expect(pending.working.comments!.map(({ id }) => id)).toEqual([comment.id]);
  });

  it("não reaplica um delta quando outra aba já gravou a mesma revisão", async () => {
    const base = replica({ cursor: 3 });
    const changes = { tasks: { upsert: [], remove: [] } };
    const reused = await reconcileReplica(base, { remote: snapshot(null, 3, user, changes), fromCursor: 2 });
    expect(reused).toBe(base);
    await expect(reconcileReplica(base, { remote: snapshot(null, 4, user, changes), fromCursor: 2 }))
      .rejects.toThrow("avançou durante a sincronização");
    expect(await reconcileReplica(base, { remote: snapshot(null, 3), fromCursor: 3 })).toBe(base);
    await expect(reconcileReplica(base, { remote: snapshot(null, 2), fromCursor: 2 }))
      .rejects.toThrow("avançou durante a sincronização");
  });
});

describe("synchronizeReplica", () => {
  function harness(replies: (operation?: Operation) => SyncReply | Promise<SyncReply>, remote = () => snapshot(null, 1)) {
    const updates: unknown[] = [];
    const request = vi.fn<SyncRequest>(async (method, path, body) =>
      method === "GET" ? ok(remote()) : replies(body as Operation));
    const reconcile = vi.fn(async (update: unknown) => { updates.push(update); });
    return { request, reconcile, updates };
  }

  it("envia a fila na ordem e confirma o prefixo aplicado", async () => {
    const base = await queued(await queued(replica(), "/tasks", { title: "Um" }), "/tasks", { title: "Dois" });
    const { request, reconcile, updates } = harness(() => ok({ outcome: "applied" }));
    await synchronizeReplica(base, { request, reconcile });
    const posts = request.mock.calls.filter(([method]) => method === "POST");
    expect(posts.map(([, path]) => path)).toEqual(["/api/v1/desktop-sync", "/api/v1/desktop-sync"]);
    expect(posts.map(([, , body]) => (body as { userId: string }).userId)).toEqual([user.id, user.id]);
    expect(updates).toHaveLength(2);
    expect(updates[1]).toMatchObject({ removed: new Set(base.pending.map((operation) => operation.id)) });
    expect(request.mock.calls[0][1]).toBe("/api/v1/desktop-sync?cursor=1&incremental=1");
  });

  it("só lê quando a fila está vazia", async () => {
    const { request, reconcile } = harness(() => ok({ outcome: "applied" }));
    await synchronizeReplica(replica(), { request, reconcile });
    expect(request).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("para na primeira operação que canPush recusar", async () => {
    const base = await queued(await queued(replica(), "/tasks", { title: "Um" }), "/tasks", { title: "Dois" });
    const { request, reconcile } = harness(() => ok({ outcome: "applied" }));
    await synchronizeReplica(base, { request, reconcile, canPush: async (operation) => operation.id !== base.pending[1].id });
    expect(request.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
    await synchronizeReplica(base, { request, reconcile, canPush: () => false });
    expect(request.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
  });

  it("repassa o aviso do servidor ou o aviso padrão de operação ignorada", async () => {
    const base = await queued(replica(), "/tasks", { title: "Um" });
    for (const [reply, notice] of [
      [{ outcome: "ignored" }, "Uma alteração pendente deixou de ser aplicável."],
      [{ outcome: "applied", message: "Mesclada com outra alteração." }, "Mesclada com outra alteração."],
    ] as const) {
      const { request, reconcile, updates } = harness(() => ok(reply));
      await synchronizeReplica(base, { request, reconcile });
      expect(updates.at(-1)).toMatchObject({ notice });
    }
  });

  it("pede login quando a sessão expira ou a conta muda, mantendo a confirmação parcial", async () => {
    const base = await queued(await queued(replica(), "/tasks", { title: "Um" }), "/tasks", { title: "Dois" });
    let calls = 0;
    const partial = harness(() => (calls++ === 0 ? ok({ outcome: "applied" }) : { status: 401, body: null }));
    expect(await rejects(synchronizeReplica(base, partial))).toMatchObject({ state: "login", identityChanged: false });
    expect(partial.updates.at(-1)).toMatchObject({ removed: new Set([base.pending[0].id]) });

    for (const reply of [{ status: 403, body: null }, { status: 409, body: { error: { code: "DESKTOP_ACCOUNT_CHANGED" } } }]) {
      const { request, reconcile } = harness(() => reply);
      expect(await rejects(synchronizeReplica(base, { request, reconcile }))).toMatchObject({ state: "login" });
    }
  });

  it("bloqueia a fila quando o servidor rejeita a operação e a repete em falhas transitórias", async () => {
    const base = await queued(replica(), "/tasks", { title: "Um" });
    const [operation] = base.pending;
    const cases: [SyncReply, string | undefined, string][] = [
      [{ status: 422, body: { error: { message: "Dados inválidos." } } }, operation.id, "Dados inválidos."],
      [{ status: 400, body: null }, operation.id, "A operação ficou na fila para a próxima tentativa."],
      [{ status: 408, body: null }, undefined, "A operação ficou na fila para a próxima tentativa."],
      [{ status: 429, body: null }, undefined, "A operação ficou na fila para a próxima tentativa."],
      [{ status: 503, body: null }, undefined, "A operação ficou na fila para a próxima tentativa."],
      [ok({ outcome: "desconhecido" }), undefined, "A operação ficou na fila para a próxima tentativa."],
      [ok(null), undefined, "A operação ficou na fila para a próxima tentativa."],
    ];
    for (const [reply, blocked, message] of cases) {
      const { request, reconcile } = harness(() => reply);
      const error = await rejects(synchronizeReplica(base, { request, reconcile }));
      expect(error, String(reply.status)).toMatchObject({ state: "error", blocked, message });
    }
  });

  it("classifica falhas de rede como offline e erros após a leitura como erro", async () => {
    const base = await queued(replica(), "/tasks", { title: "Um" });
    const down = vi.fn<SyncRequest>(async () => { throw new TypeError("Falha de rede"); });
    expect(await rejects(synchronizeReplica(base, { request: down, reconcile: async () => undefined })))
      .toMatchObject({ state: "offline", message: "Falha de rede" });

    const opaque = vi.fn<SyncRequest>(async () => { throw "sem detalhes"; });
    expect((await rejects(synchronizeReplica(base, { request: opaque, reconcile: async () => undefined }))).message)
      .toBe("Não foi possível alcançar o servidor.");

    const flaky = harness(() => { throw new Error("Conexão perdida"); });
    expect(await rejects(synchronizeReplica(base, flaky))).toMatchObject({ state: "error", message: "Conexão perdida" });

    const failing = vi.fn(async () => { throw new Error("Disco cheio"); });
    expect(await rejects(synchronizeReplica(base, { request: harness(() => ok({ outcome: "applied" })).request, reconcile: failing })))
      .toMatchObject({ state: "error", message: "Disco cheio" });
  });

  it("não perde o erro original quando a confirmação parcial também falha", async () => {
    const base = await queued(await queued(replica(), "/tasks", { title: "Um" }), "/tasks", { title: "Dois" });
    let posts = 0;
    const request = vi.fn<SyncRequest>(async (method) => {
      if (method === "GET") return posts > 0 ? { status: 500, body: null } : ok(snapshot(null, 1));
      return posts++ === 0 ? ok({ outcome: "applied" }) : { status: 503, body: { error: { message: "Indisponível." } } };
    });
    expect(await rejects(synchronizeReplica(base, { request, reconcile: async () => undefined })))
      .toMatchObject({ state: "error", message: "Indisponível." });
  });

  it("rejeita o instantâneo de outra conta ao sincronizar", async () => {
    const { request, reconcile } = harness(() => ok({ outcome: "applied" }), () => snapshot(null, 1, other));
    expect(await rejects(synchronizeReplica(replica(), { request, reconcile })))
      .toMatchObject({ state: "login", identityChanged: true });
  });
});
