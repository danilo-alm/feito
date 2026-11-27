import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import type { TaskComment as StoredComment } from "@feito/core/domain/product";
import type { TaskComment, TaskComments } from "@feito/core/types";
import type { DesktopWriteResult } from "@/server/db/desktop-sync";
import { activateDek, rekeyWithActiveDek } from "@/server/db/rotation";
import { taskComments } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import {
  accountFixture, failure, getTaskById, newProject, newTask, payload, productAccess, send, type Client,
} from "./product-client";

// Dados sintéticos em PostgreSQL descartável.
const list = (client: Client, taskId: string) =>
  client("GET", `/tasks/${taskId}/comments`).then((response) => payload<TaskComments>(response));
const create = (client: Client, taskId: string, body: string) =>
  client("POST", `/tasks/${taskId}/comments`, { body }).then((response) => payload<TaskComment>(response, 201));
const revisionOf = (client: Client) =>
  client("GET", "/desktop-sync?cursor=0").then((response) => payload<{ cursor: number }>(response)).then(({ cursor }) => cursor);

test("cria, lista, edita e remove comentários cifrados e conta-os no detalhe da tarefa", async () => {
  const client = await accountFixture();
  const task = await newTask(client, "Comentada");
  expect(task.commentCount).toBe(0);
  const start = await revisionOf(client);

  const first = await create(client, task.id, "  Primeiro comentário  ");
  expect(first).toEqual({
    id: expect.any(String), taskId: task.id, revision: 1, body: "Primeiro comentário",
    createdAt: expect.any(String), editedAt: null,
  });
  const second = await create(client, task.id, "Segundo");
  expect(await revisionOf(client)).toBe(start + 2);
  expect((await list(client, task.id)).comments.map(({ id }) => id)).toEqual([first.id, second.id]);
  expect((await getTaskById(client, task.id)).commentCount).toBe(2);

  const edited = await payload<TaskComment>(await client("PATCH", `/comments/${first.id}`, { revision: 1, body: "Editado" }));
  expect(edited).toMatchObject({ id: first.id, revision: 2, body: "Editado", createdAt: first.createdAt, editedAt: expect.any(String) });
  const unchanged = await payload<TaskComment>(await client("PATCH", `/comments/${first.id}`, { revision: 2, body: "Editado" }));
  expect(unchanged).toEqual(edited);
  expect(await revisionOf(client)).toBe(start + 3);
  const conflict = await failure(await client("PATCH", `/comments/${first.id}`, { revision: 1, body: "Antigo" }), 409, "REVISION_CONFLICT");
  expect(conflict.details).toMatchObject({ current: { revision: 2, body: "Editado" } });

  await failure(await client("DELETE", `/comments/${second.id}?revision=3`), 409, "REVISION_CONFLICT");
  const removed = await client("DELETE", `/comments/${second.id}?revision=1`);
  expect(removed.status).toBe(204);
  expect(removed.headers.get("Cache-Control")).toBe("private, no-store");
  await failure(await client("DELETE", `/comments/${second.id}?revision=1`), 404, "NOT_FOUND");
  expect((await list(client, task.id)).comments).toEqual([edited]);

  // O texto fica cifrado no banco, ligado ao comentário e à tarefa.
  const rows = await withTenant(productAccess(client).db, client.tenantId, (tx) =>
    tx.select().from(taskComments).where(eq(taskComments.id, first.id)));
  expect(rows).toHaveLength(1);
  expect(rows[0].ciphertext.toString("utf8")).not.toContain("Editado");
});

test("valida a entrada e trata recursos de outra conta como ausentes", async () => {
  const client = await accountFixture();
  const other = await accountFixture();
  const task = await newTask(client, "Privada");
  const comment = await create(client, task.id, "Só meu");

  for (const body of [{ body: "" }, { body: " \n " }, { body: "x".repeat(10_001) }, { body: 1 }, { body: "ok", revision: 1 }]) {
    await failure(await client("POST", `/tasks/${task.id}/comments`, body), 422, "VALIDATION_FAILED");
  }
  await failure(await client("PATCH", `/comments/${comment.id}`, { body: "sem revisão" }), 422, "VALIDATION_FAILED");
  await failure(await client("DELETE", `/comments/${comment.id}`), 422, "VALIDATION_FAILED");
  await failure(await client("GET", "/tasks/nao-e-uuid/comments"), 404, "NOT_FOUND");
  await failure(await client("GET", `/tasks/${randomUUID()}/comments`), 404, "NOT_FOUND");

  await failure(await other("GET", `/tasks/${task.id}/comments`), 404, "NOT_FOUND");
  await failure(await other("POST", `/tasks/${task.id}/comments`, { body: "Intruso" }), 404, "NOT_FOUND");
  await failure(await other("PATCH", `/comments/${comment.id}`, { revision: 1, body: "Intruso" }), 404, "NOT_FOUND");
  await failure(await other("DELETE", `/comments/${comment.id}?revision=1`), 404, "NOT_FOUND");
  expect((await list(client, task.id)).comments).toEqual([comment]);

  await failure(await send("GET", `/tasks/${task.id}/comments`), 401, "UNAUTHENTICATED");
  await failure(await client("POST", `/tasks/${task.id}/comments`, { body: "x" },
    { headers: { Origin: "https://other.example.test" } }), 403, "FORBIDDEN_ORIGIN");
});

test("protege projetos arquivados e remove os comentários com a tarefa", async () => {
  const client = await accountFixture();
  const project = await newProject(client, "Arquivo");
  const task = await newTask(client, "Arquivada", { projectId: project.id });
  const comment = await create(client, task.id, "Antes de arquivar");
  await payload(await client("POST", `/projects/${project.id}/archive`, { revision: project.revision }));
  await failure(await client("POST", `/tasks/${task.id}/comments`, { body: "Depois" }), 409, "PROJECT_ARCHIVED");
  await failure(await client("PATCH", `/comments/${comment.id}`, { revision: 1, body: "x" }), 409, "PROJECT_ARCHIVED");
  expect((await list(client, task.id)).comments).toHaveLength(1);

  const parent = await newTask(client, "Pai");
  const child = await newTask(client, "Filha", { parentId: parent.id });
  await create(client, child.id, "Na subtarefa");
  const removed = await client("DELETE", `/tasks/${parent.id}?revision=${parent.revision}&withChildren=true`);
  expect(removed.status).toBe(204);
  const remaining = await withTenant(productAccess(client).db, client.tenantId, (tx) => tx.select().from(taskComments));
  expect(remaining.map(({ id }) => id)).toEqual([comment.id]);
});

test("sincroniza comentários com o desktop, de forma idempotente e incremental", async () => {
  type Changes = { comments?: { upsert: StoredComment[]; remove: string[] }; tasks?: { remove: string[] } };
  type Snapshot = { cursor: number; workspace: { comments: StoredComment[] } | null; changes?: Changes };
  const pull = (client: Client, query = "") =>
    client("GET", "/desktop-sync" + query).then((response) => payload<Snapshot>(response));
  const push = (client: Client, input: Record<string, unknown>) =>
    client("POST", "/desktop-sync", input).then((response) => payload<DesktopWriteResult>(response));
  const operation = (method: string, path: string, body?: unknown, generatedIds?: string[]) =>
    ({ id: randomUUID(), authoredAt: "2026-11-20T12:00:00.000Z", method, path, body, generatedIds });

  const client = await accountFixture();
  const task = await newTask(client, "Sincronizada");
  const base = await pull(client);
  expect(base.workspace?.comments).toEqual([]);

  const id = randomUUID();
  const created = operation("POST", `/tasks/${task.id}/comments`, { body: "Do desktop" }, [id]);
  expect(await Promise.all([push(client, created), push(client, created)]))
    .toEqual([{ outcome: "applied" }, { outcome: "applied" }]);
  const comment = (await list(client, task.id)).comments[0];
  expect(comment).toMatchObject({ id, body: "Do desktop", createdAt: "2026-11-20T12:00:00Z" });

  const delta = await pull(client, `?cursor=${base.cursor}&incremental=1`);
  expect(delta.changes?.comments).toMatchObject({ upsert: [{ id, taskId: task.id, revision: 1, data: { body: "Do desktop" } }], remove: [] });
  expect((await pull(client)).workspace?.comments).toMatchObject([{ id }]);

  expect(await push(client, operation("PATCH", `/comments/${id}`, { revision: 1, body: "Editado offline" })))
    .toEqual({ outcome: "applied" });
  expect(await push(client, operation("PATCH", `/comments/${id}`, { revision: 1, body: "Atrasado" })))
    .toMatchObject({ outcome: "ignored" });
  expect((await list(client, task.id)).comments[0]).toMatchObject({ revision: 2, body: "Editado offline" });

  const beforeDelete = (await pull(client)).cursor;
  expect(await push(client, operation("DELETE", `/comments/${id}?revision=2`))).toEqual({ outcome: "applied" });
  expect((await pull(client, `?cursor=${beforeDelete}&incremental=1`)).changes?.comments).toEqual({ upsert: [], remove: [id] });
  expect(await push(client, operation("PATCH", `/comments/${id}`, { revision: 2, body: "Depois de excluir" })))
    .toMatchObject({ outcome: "ignored" });
  expect(await push(client, operation("POST", `/tasks/${randomUUID()}/comments`, { body: "Sem tarefa" }, [randomUUID()])))
    .toMatchObject({ outcome: "ignored" });
  expect((await list(client, task.id)).comments).toEqual([]);
  await failure(await client("POST", "/desktop-sync", operation("POST", `/comments/${id}`, { body: "x" })), 422, "DESKTOP_OPERATION_UNSUPPORTED");
});

test("exporta, restaura e recifra os comentários", async () => {
  const source = await accountFixture();
  const task = await newTask(source, "Com histórico");
  await create(source, task.id, "Primeiro");
  const second = await create(source, task.id, "Segundo");
  await payload(await source("PATCH", `/comments/${second.id}`, { revision: 1, body: "Segundo, editado" }));

  const exported = await source("GET", "/export");
  expect(exported.status).toBe(200);
  const file = new Uint8Array(await exported.arrayBuffer());
  const document = JSON.parse(new TextDecoder().decode(file));
  expect(document.comments.map(({ body }: { body: string }) => body)).toEqual(["Primeiro", "Segundo, editado"]);

  const target = await accountFixture();
  const operationId = randomUUID();
  const preview = await payload<{ previewToken: string }>(await target("POST", "/import/preview", undefined, {
    raw: file, headers: { "X-Operation-Id": operationId },
  }));
  await payload(await target("POST", "/import/confirm", undefined, {
    raw: file, headers: { "X-Operation-Id": operationId, "X-Preview-Token": preview.previewToken },
  }));
  const rows = await withTenant(productAccess(target).db, target.tenantId, (tx) => tx.select().from(taskComments));
  expect(rows).toHaveLength(2);
  const restored = await list(target, rows[0].taskId);
  expect(restored.comments.map(({ body }) => body)).toEqual(["Primeiro", "Segundo, editado"]);
  expect((await getTaskById(target, rows[0].taskId)).commentCount).toBe(2);

  const access = productAccess(target);
  expect(await activateDek(access)).toBe(2);
  expect(await rekeyWithActiveDek(access)).toBeGreaterThan(0);
  const rekeyed = await withTenant(access.db, target.tenantId, (tx) => tx.select().from(taskComments));
  expect(rekeyed.every(({ dekVersion }) => dekVersion === 2)).toBe(true);
  expect((await list(target, rows[0].taskId)).comments.map(({ body }) => body)).toEqual(["Primeiro", "Segundo, editado"]);
});
