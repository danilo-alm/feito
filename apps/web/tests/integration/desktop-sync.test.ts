import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import type { CompletedOccurrence, Task as ProductTask } from "@feito/core/domain/product";
import type { DesktopWriteResult } from "@/server/db/desktop-sync";
import { advanceProductRevision, lockTenant, withTenant } from "@/server/db/tenant";
import type { Preferences } from "@feito/core/validation/preferences";
import {
  accountFixture, failure, getTaskById, nav, newLabel, newProject, newTask, payload, productAccess, send, type Client,
} from "./product-client";

type Snapshot = {
  cursor: number;
  user: { id: string; email: string };
  workspace: {
    tasks: ProductTask[];
    occurrences: CompletedOccurrence[];
    preferences: Preferences;
  } | null;
  changes?: {
    tasks?: { upsert: ProductTask[]; remove: string[] };
    taskLabels?: [string, string[]][];
    occurrences?: [string, CompletedOccurrence[]][];
    preferences?: Preferences;
  };
};

function pull(client: Client, cursor?: number, incremental = false) {
  const query = cursor === undefined ? "" : `?cursor=${cursor}${incremental ? "&incremental=1" : ""}`;
  return client("GET", "/desktop-sync" + query)
    .then((response) => payload<Snapshot>(response));
}

function command(method: string, path: string, body?: unknown) {
  return { id: randomUUID(), authoredAt: new Date().toISOString(), method, path, body };
}

function push(client: Client, input: ReturnType<typeof command> & { generatedIds?: string[]; userId?: string }) {
  return client("POST", "/desktop-sync", input).then((response) => payload<DesktopWriteResult>(response));
}

test("entrega a base da conta e reenvia uma criação concorrente sem duplicatas", async () => {
  const client = await accountFixture();
  const other = await accountFixture();
  const before = await pull(client);
  expect(before.workspace?.tasks).toEqual([]);
  expect((await pull(client, before.cursor)).workspace).toBeNull();
  const id = randomUUID();
  const op = { ...command("POST", "/tasks", { title: "Criada offline" }), userId: before.user.id, generatedIds: [id] };
  expect(await Promise.all([push(client, op), push(client, op)])).toEqual([
    { outcome: "applied" }, { outcome: "applied" },
  ]);
  const after = await pull(client, before.cursor);
  expect(after.cursor).toBe(before.cursor + 1);
  expect(after.workspace?.tasks).toMatchObject([{ id, data: { title: "Criada offline" } }]);
  expect((await pull(other)).workspace?.tasks).toEqual([]);
  await failure(await other("POST", "/desktop-sync", op), 409, "DESKTOP_ACCOUNT_CHANGED");
  await failure(await client("POST", "/desktop-sync", { ...op, body: { title: "Diferente" } }), 409, "DESKTOP_OPERATION_REUSED");
  await failure(await send("GET", "/desktop-sync"), 401, "UNAUTHENTICATED");
  await failure(await client("POST", "/desktop-sync", op, { headers: { Origin: "https://other.example.test" } }), 403, "FORBIDDEN_ORIGIN");
});

test("reconcilia por campo em função da hora da edição e mantém exclusões", async () => {
  const client = await accountFixture();
  const task = await newTask(client, "Texto inicial");
  const offline = command("PATCH", `/tasks/${task.id}`, {
    revision: task.revision, title: "Título offline", description: "Descrição offline",
  });
  const edited = await client("PATCH", `/tasks/${task.id}`, { revision: task.revision, title: "Título do site" })
    .then((response) => payload<{ revision: number }>(response));
  expect(await push(client, offline)).toEqual({ outcome: "applied" });
  const merged = await getTaskById(client, task.id);
  expect(merged).toMatchObject({
    title: "Título do site", description: "Descrição offline", revision: edited.revision + 1,
  });
  expect(await push(client, command("PATCH", `/tasks/${task.id}`, {
    revision: task.revision, title: "Edição posterior no desktop",
  }))).toEqual({ outcome: "applied" });
  const latest = await getTaskById(client, task.id);
  expect(latest.title).toBe("Edição posterior no desktop");
  const beforeDeletion = await pull(client);
  const remove = await client("DELETE", `/tasks/${task.id}?revision=${latest.revision}`);
  expect(remove.status).toBe(204);
  const stale = command("PATCH", `/tasks/${task.id}`, { revision: merged.revision, title: "Depois da exclusão" });
  expect(await push(client, stale)).toMatchObject({ outcome: "ignored" });
  expect(await push(client, stale)).toMatchObject({ outcome: "ignored" });
  expect(await push(client, {
    ...command("POST", "/tasks", { title: "Mesmo identificador" }), generatedIds: [task.id],
  })).toMatchObject({ outcome: "ignored" });
  const afterDeletion = await pull(client, beforeDeletion.cursor);
  expect(afterDeletion.cursor).toBe(beforeDeletion.cursor + 1);
  expect(afterDeletion.workspace?.tasks).toEqual([]);
});

test("usa a data offline da conclusão recorrente e preserva o ID da próxima ocorrência", async () => {
  const client = await accountFixture();
  const taskId = randomUUID();
  const occurrenceId = randomUUID();
  const nextId = randomUUID();
  expect(await push(client, {
    ...command("POST", "/tasks", { title: "Diária", dueDate: "2026-01-02", recurrence: { frequency: "daily" } }),
    authoredAt: "2026-01-02T13:00:00.000Z", generatedIds: [taskId, occurrenceId],
  })).toEqual({ outcome: "applied" });
  const complete = {
    ...command("POST", `/tasks/${taskId}/complete`, { revision: 1, occurrenceId }),
    authoredAt: "2026-01-03T13:00:00.000Z", generatedIds: [nextId],
  };
  expect(await push(client, complete)).toEqual({ outcome: "applied" });
  expect(await push(client, { ...complete, id: randomUUID() })).toEqual({ outcome: "applied" });
  expect(await push(client, {
    ...command("PUT", `/tasks/${taskId}/recurrence`, { revision: 2, frequency: "weekly", anchorDate: "2026-01-05" }),
    generatedIds: [occurrenceId],
  })).toMatchObject({ outcome: "ignored" });
  const { workspace } = await pull(client);
  expect(workspace?.tasks).toMatchObject([{ id: taskId, occurrenceId: nextId, data: { dueDate: "2026-01-04" } }]);
  expect(workspace?.occurrences).toMatchObject([{
    taskId, occurrenceId, data: { nextOccurrenceId: nextId, completedAt: "2026-01-03T13:00:00Z" },
  }]);
});

test("sincroniza preferências independentes com recibo e mantém a edição recente do site", async () => {
  const client = await accountFixture();
  const initial = await pull(client);
  const offline = command("PATCH", "/preferences", { theme: "dark", timezone: "UTC", locale: "en" });
  await payload(await client("PATCH", "/preferences", { theme: "light" }));
  expect(await push(client, offline)).toEqual({ outcome: "applied" });
  expect(await push(client, offline)).toEqual({ outcome: "applied" });
  const latest = await pull(client, initial.cursor);
  expect(latest.cursor).toBe(initial.cursor + 2);
  expect(latest.workspace?.preferences).toEqual({ theme: "light", timezone: "UTC", locale: "en" });
  const staleLocale = command("PATCH", "/preferences", { locale: "pt-BR" });
  await payload(await client("PATCH", "/preferences", { locale: "en" }));
  expect(await push(client, staleLocale)).toMatchObject({ outcome: "ignored" });
  expect((await pull(client)).workspace?.preferences.locale).toBe("en");
});

test("entrega alterações e exclusões do site por cursor e refaz a base após uma lacuna", async () => {
  const client = await accountFixture();
  const initial = await pull(client);
  const label = await newLabel(client, "Etiqueta da tarefa");
  const task = await newTask(client, "Do site", { labelIds: [label.id] });
  await payload(await client("PATCH", "/preferences", { theme: "dark" }));
  const first = await pull(client, initial.cursor, true);
  expect(first.workspace).toBeNull();
  expect(first.changes).toMatchObject({
    preferences: { theme: "dark" },
    tasks: { upsert: [{ id: task.id }], remove: [] },
    taskLabels: [[task.id, [label.id]]],
  });
  const deletion = await client("DELETE", `/tasks/${task.id}?revision=${task.revision}`);
  expect(deletion.status).toBe(204);
  const deleted = await pull(client, first.cursor, true);
  expect(deleted).toMatchObject({
    workspace: null,
    changes: {
      tasks: { upsert: [], remove: [task.id] },
      occurrences: [[task.id, []]],
      taskLabels: [[task.id, []]],
    },
  });
  expect((await pull(client, deleted.cursor, true)).changes).toBeUndefined();

  // Rotação e restauração podem avançar a revisão sem um delta no diário.
  const { db, tenantId } = productAccess(client);
  await withTenant(db, tenantId, async (tx) => advanceProductRevision(tx, await lockTenant(tx, tenantId)));
  const next = await newTask(client, "Depois da lacuna");
  const recovered = await pull(client, deleted.cursor, true);
  expect(recovered.changes).toBeUndefined();
  expect(recovered.workspace?.tasks).toMatchObject([{ id: next.id }]);
});

test("mantém os IDs entre operações dependentes e ignora um movimento para projeto removido", async () => {
  const client = await accountFixture();
  const projectId = randomUUID();
  const sectionId = randomUUID();
  const labelId = randomUUID();
  const taskId = randomUUID();
  expect(await push(client, {
    ...command("POST", "/projects", { name: "Projeto offline" }), generatedIds: [projectId],
  })).toEqual({ outcome: "applied" });
  expect(await push(client, {
    ...command("POST", `/projects/${projectId}/sections`, { name: "Seção offline" }), generatedIds: [sectionId],
  })).toEqual({ outcome: "applied" });
  expect(await push(client, {
    ...command("POST", "/labels", { name: "Etiqueta offline" }), generatedIds: [labelId],
  })).toEqual({ outcome: "applied" });
  expect(await push(client, {
    ...command("POST", "/tasks", { title: "Tarefa offline", projectId, sectionId, labelIds: [labelId], id: taskId }),
    generatedIds: [taskId],
  })).toEqual({ outcome: "applied" });
  expect(await getTaskById(client, taskId)).toMatchObject({
    projectId, sectionId, labels: [{ id: labelId }],
  });
  const target = await newProject(client, "Destino");
  const inbox = (await nav(client)).inbox.projectId;
  const inboxTask = await newTask(client, "Continua na Caixa de entrada");
  const move = command("POST", `/tasks/${inboxTask.id}/move`, {
    revision: inboxTask.revision,
    target: { type: "position", projectId: target.id, sectionId: null, parentId: null },
  });
  const removed = await client("DELETE", `/projects/${target.id}?revision=${target.revision}`);
  expect(removed.status).toBe(204);
  expect(await push(client, move)).toMatchObject({ outcome: "ignored" });
  expect((await getTaskById(client, inboxTask.id)).projectId).toBe(inbox);
});

test("avisa mudanças confirmadas da conta e informa a revisão atual ao reconectar", async () => {
  const client = await accountFixture();
  const other = await accountFixture();
  await failure(await send("GET", "/product-events"), 401, "UNAUTHENTICATED");
  const initial = (await pull(client)).cursor;
  const response = await client("GET", "/product-events", undefined, { signal: AbortSignal.timeout(5_000) });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  const event = (revision: number) => `event: revision\ndata: ${revision}\n\n`;
  try {
    expect((await reader.read()).value).toBe(event(initial));
    await newTask(other, "Alteração em outra conta");
    await expect(withTenant(productAccess(client).db, client.tenantId, async (tx) => {
      await advanceProductRevision(tx, await lockTenant(tx, client.tenantId));
      throw new Error("rollback do teste");
    })).rejects.toThrow("rollback do teste");
    await newTask(client, "Recebida pelo canal");
    expect((await reader.read()).value).toBe(event(initial + 1));
    await newTask(client, "Recebida na mesma conexão");
    expect((await reader.read()).value).toBe(event(initial + 2));
  } finally {
    await reader.cancel();
  }

  await newTask(client, "Gravada enquanto o canal estava fechado");
  const resumed = await client("GET", "/product-events", undefined, { signal: AbortSignal.timeout(5_000) });
  const resumedReader = resumed.body!.pipeThrough(new TextDecoderStream()).getReader();
  try {
    expect((await resumedReader.read()).value).toBe(event(initial + 3));
    expect((await client("POST", "/auth/logout")).status).toBe(204);
    await withTenant(productAccess(client).db, client.tenantId, async (tx) => {
      await advanceProductRevision(tx, await lockTenant(tx, client.tenantId));
    });
    expect((await resumedReader.read()).done).toBe(true);
  } finally {
    await resumedReader.cancel();
  }
});
