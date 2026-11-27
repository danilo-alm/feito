import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultPreferences } from "@feito/core/domain/preferences";
import { connectDatabase } from "@/server/db/client";
import { tenantKeys, tenants } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { unwrapDek } from "@/server/crypto/envelope";
import type { PortableDocument } from "@/server/portability/document";
import type { previewImport } from "@/server/services/portability";
import type { getMe } from "@/server/services/workspace";
import type { ImportCounts } from "@/validation/portability";
import {
  accountFixture, completeTaskById, failure, newLabel, newProject, newSection, newTask,
  page, payload, productAccess, send, type Client, type Resource, type Task,
} from "./product-client";

type Preview = Awaited<ReturnType<typeof previewImport>>;
type Receipt = { operationId: string; summary: ImportCounts };

afterEach(() => vi.restoreAllMocks());

async function download(call: Client) {
  const response = await call("GET", "/export");
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="feito-dados-\d{4}-\d{2}-\d{2}\.json"$/);
  return response.text();
}

async function inspect(call: Client, raw: string, operationId?: string) {
  const response = await call("POST", "/import/preview", undefined, {
    raw, headers: operationId ? { "X-Operation-Id": operationId } : undefined,
  });
  return { ...await payload<Preview>(response), operationId: response.headers.get("X-Operation-Id") };
}

function confirm(call: Client, file: string, preview: { operationId: string | null; previewToken: string | null }) {
  return call("POST", "/import/confirm", undefined, {
    raw: file, headers: { "X-Operation-Id": preview.operationId!, "X-Preview-Token": preview.previewToken! },
  });
}

async function hasWorkspace(call: Client) {
  const { db, tenantId } = productAccess(call);
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx.select({ id: tenants.id }).from(tenants);
    return !!row;
  });
}

function documentWithoutInstant(file: string) {
  const { exportedAt: _instant, ...document } = JSON.parse(file) as PortableDocument;
  return document;
}

describe("portable export and restoration", () => {
  it("round-trips an entire nested branch, including completed descendants", async () => {
    const source = await accountFixture();
    const target = await accountFixture();
    const project = await newProject(source);
    const root = await newTask(source, "Raiz", { projectId: project.id });
    const child = await newTask(source, "Filha", { parentId: root.id });
    const grandchild = await newTask(source, "Neta", { parentId: child.id });
    const leaf = await newTask(source, "Último nível", { parentId: grandchild.id });
    await completeTaskById(source, leaf);

    const file = await download(source);
    const preview = await inspect(target, file);
    expect(preview.errors).toEqual([]);
    expect(preview.counts).toMatchObject({ tasks: 4, completedTasks: 1 });
    await payload(await confirm(target, file, preview));
    expect(documentWithoutInstant(await download(target))).toEqual(documentWithoutInstant(file));
  });

  it("round-trips product data between tenants with distinct DEKs and records one repeatable receipt", async () => {
    const clock = vi.spyOn(Temporal.Now, "instant").mockReturnValue(Temporal.Instant.from("2027-01-31T14:00:00Z"));
    const [source, target] = await Promise.all([accountFixture(), accountFixture()]);
    const other = await accountFixture(true);
    expect((await source("PATCH", "/preferences", { theme: "dark", timezone: "UTC" })).status).toBe(200);
    const project = await newProject(source, "Projeto ativo");
    const archived = await newProject(source, "Projeto arquivado");
    const left = await newSection(source, project.id, "Primeira");
    const right = await newSection(source, project.id, "Segunda");
    const label = await newLabel(source, "Café");
    expect((await source("PATCH", `/projects/${project.id}/view`, { layout: "board", sortMode: "priority", showCompleted: true })).status).toBe(200);
    const noDate = await newTask(source, "Sem data", { labelIds: [label.id], description: "Linha 1\nLinha 2" });
    const parent = await newTask(source, "Pai", { projectId: project.id, sectionId: left.id });
    await newTask(source, "Subtarefa", { parentId: parent.id, dueDate: "2027-01-30", labelIds: [label.id] });
    await completeTaskById(source, parent, true);
    await newTask(source, "Arquivada", { projectId: archived.id, dueDate: "2027-01-10" });
    expect((await source("POST", `/projects/${archived.id}/archive`, { revision: archived.revision })).status).toBe(200);
    const recurring = await newTask(source, "Série", {
      projectId: project.id, sectionId: right.id, dueDate: "2027-01-31",
      recurrence: { frequency: "monthly", time: "08:00" },
    });
    const firstDone = await payload<{ task: Task }>(await source("POST", `/tasks/${recurring.id}/complete`, {
      revision: recurring.revision, occurrenceId: recurring.occurrenceId,
    }));
    expect(firstDone.task.dueDate).toBe("2027-02-28");
    await payload<Task>(await source("PATCH", `/tasks/${recurring.id}`, {
      revision: firstDone.task.revision, dueDate: "2027-03-03", dueTime: "10:00",
    }));
    clock.mockReturnValue(Temporal.Instant.from("2027-02-12T14:00:00Z"));

    const inbox = await payload<Awaited<ReturnType<typeof getMe>>>(await target("GET", "/me"));
    const file = await download(source);
    expect(file).not.toContain(source.tenantId);
    expect(file).not.toContain(noDate.id);
    expect(file).not.toContain(recurring.occurrenceId!);
    expect(file).not.toContain(firstDone.task.occurrenceId!);
    expect(JSON.parse(file).occurrences[0]).not.toHaveProperty("nextOccurrenceId");
    const before = await inspect(target, file);
    expect(before).toMatchObject({ schemaVersion: 2, destinationEmpty: true, errors: [], counts: {
      projects: 3, archivedProjects: 1, sections: 2, tasks: 5, completedTasks: 2, labels: 1, occurrences: 1,
    } });
    expect(before.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(before.previewToken).toBeTruthy();

    const [one, two] = await Promise.all([confirm(target, file, before), confirm(target, file, before)]);
    const receipt = await payload<Receipt>(one);
    expect(await payload<Receipt>(two)).toEqual(receipt);
    expect(await payload(await target("GET", `/import/operations/${receipt.operationId}`)))
      .toEqual({ status: "completed", ...receipt });
    await failure(await source("GET", `/import/operations/${receipt.operationId}`), 404, "NOT_FOUND");
    await failure(await other("GET", "/export"), 403, "PASSWORD_CHANGE_REQUIRED");

    for (const account of [source, target]) {
      expect(await hasWorkspace(account)).toBe(true);
    }
    async function dek(call: Client) {
      const { db, tenantId, keys } = productAccess(call);
      const [key] = await withTenant(db, tenantId, (tx) => tx.select().from(tenantKeys));
      return unwrapDek(keys, key);
    }
    const [sourceKey, targetKey] = await Promise.all([dek(source), dek(target)]);
    try {
      expect(sourceKey.equals(targetKey)).toBe(false);
    } finally {
      sourceKey.fill(0);
      targetKey.fill(0);
    }

    const currentInbox = await payload<Awaited<ReturnType<typeof getMe>>>(await target("GET", "/me"));
    expect(currentInbox).toMatchObject({ inboxProjectId: inbox.inboxProjectId, preferences: { theme: "dark", timezone: "UTC" } });
    clock.mockReturnValue(Temporal.Instant.from("2027-02-12T14:01:00Z"));
    expect(documentWithoutInstant(await download(target))).toEqual(documentWithoutInstant(file));

    const listed = await payload<{ projects: Resource[] }>(await target("GET", "/projects"));
    const projectPage = await page(target, listed.projects[0].id, "?includeCompleted=true");
    const restored = projectPage.tasks.find((task) => task.title === "Série")!;
    expect(restored).toMatchObject({ dueDate: "2027-03-03", dueTime: "10:00" });
    expect(restored.id).not.toBe(recurring.id);
    const next = await payload<{ task: Task }>(await target("POST", `/tasks/${restored.id}/complete`, {
      revision: restored.revision, occurrenceId: restored.occurrenceId,
    }));
    expect(next.task).toMatchObject({ dueDate: "2027-03-31", dueTime: "08:00" });

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 16 * 60 * 1000);
    await failure(await confirm(target, file, before), 410, "PREVIEW_EXPIRED");
    expect(await payload(await target("GET", `/import/operations/${receipt.operationId}`)))
      .toEqual({ status: "completed", ...receipt });
  });

  it("rejects invalid files, mismatched bytes and operation IDs, expiry, and cross-account tokens", async () => {
    const [source, target] = await Promise.all([accountFixture(), accountFixture()]);
    const other = await accountFixture();
    await newTask(source, "Origem");
    const file = await download(source);
    const malformed = await inspect(target, '{"schemaVersion":1');
    expect(malformed).toMatchObject({ schemaVersion: null, counts: null, previewToken: null, destinationEmpty: true });
    const doc = JSON.parse(file) as PortableDocument;
    doc.tasks[0].projectId = "inexistente";
    expect(await inspect(target, JSON.stringify(doc))).toMatchObject({
      schemaVersion: 2, counts: null, previewToken: null, errors: [{ path: "tasks.0.projectId" }],
    });
    expect(await hasWorkspace(target)).toBe(false);

    const operationId = randomUUID();
    const preview = await inspect(target, file, operationId);
    expect(preview.operationId).toBe(operationId);
    await failure(await confirm(target, file + "\n", preview), 422, "IMPORT_INVALID");
    await failure(await confirm(target, file, { ...preview, operationId: randomUUID() }), 422, "IMPORT_INVALID");
    await failure(await confirm(other, file, preview), 422, "IMPORT_INVALID");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 16 * 60 * 1000);
    await failure(await confirm(target, file, preview), 410, "PREVIEW_EXPIRED");
    expect(await hasWorkspace(target)).toBe(false);
    await failure(await target("GET", `/import/operations/${operationId}`), 404, "NOT_FOUND");
  });

  it("rechecks emptiness after preview and serializes different concurrent imports", async () => {
    const [source, target] = await Promise.all([accountFixture(), accountFixture()]);
    const competing = await accountFixture();
    await newTask(source, "Original");
    const file = await download(source);
    const preview = await inspect(target, file, randomUUID());
    expect((await target("PATCH", "/preferences", { theme: "dark" })).status).toBe(200);
    await failure(await confirm(target, file, preview), 409, "DESTINATION_NOT_EMPTY");
    expect(await inspect(target, file)).toMatchObject({ destinationEmpty: false, previewToken: null });
    expect((JSON.parse(await download(target)) as PortableDocument)).toMatchObject({ preferences: { theme: "dark" }, tasks: [] });

    const before = await inspect(competing, file, randomUUID());
    const alternate = await inspect(competing, file, randomUUID());
    const changed = await Promise.all([before, alternate].map((option) =>
      inspect(competing, file + "\n", option.operationId!)));
    const [one, two] = await Promise.all([confirm(competing, file, before), confirm(competing, file, alternate)]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    const winner = one.status === 200 ? before : alternate;
    const loser = one.status === 200 ? alternate : before;
    const saved = await payload<Receipt>(one.status === 200 ? one : two);
    await failure(one.status === 409 ? one : two, 409, "DESTINATION_NOT_EMPTY");
    await failure(await competing("GET", `/import/operations/${loser.operationId}`), 404, "NOT_FOUND");
    expect(await payload(await competing("GET", `/import/operations/${winner.operationId}`)))
      .toEqual({ status: "completed", ...saved });
    const signedForOtherBytes = changed.find((option) => option.operationId === winner.operationId)!;
    await failure(await confirm(competing, file + "\n", signedForOtherBytes), 422, "IMPORT_INVALID");
    expect(documentWithoutInstant(await download(competing))).toEqual(documentWithoutInstant(file));
  });

  it("rolls back data and bootstrap if the database rejects the receipt", async () => {
    const [source, target] = await Promise.all([accountFixture(), accountFixture()]);
    await newTask(source, "Tarefa da restauração");
    const file = await download(source);
    const operationId = randomUUID();
    const before = await inspect(target, file, operationId);
    const migrator = connectDatabase("MIGRATION_DATABASE_URL", 1);
    const name = `reject_import_${operationId.replace(/-/g, "")}`;
    try {
      // Only this synthetic operation is rejected. All writes still run with feito_app.
      await migrator.db.execute(sql.raw(`
        CREATE FUNCTION domain.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.operation_id = '${operationId}'::uuid THEN
            RAISE EXCEPTION 'test rollback';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER ${name} BEFORE INSERT ON domain.import_operations
          FOR EACH ROW EXECUTE FUNCTION domain.${name}();
      `));
      await failure(await confirm(target, file, before), 500, "INTERNAL_ERROR");
      expect(await hasWorkspace(target)).toBe(false);
      await failure(await target("GET", `/import/operations/${operationId}`), 404, "NOT_FOUND");
    } finally {
      await migrator.db.execute(sql.raw(`
        DROP TRIGGER IF EXISTS ${name} ON domain.import_operations;
        DROP FUNCTION IF EXISTS domain.${name}();
      `));
      await migrator.close();
    }
    const receipt = await payload<Receipt>(await confirm(target, file, before));
    expect(receipt.operationId).toBe(operationId);
    expect(receipt.summary.tasks).toBe(1);
  });

  it("enforces auth, origin, content type, and the transport limit", async () => {
    const account = await accountFixture();
    await failure(await send("GET", "/export"), 401, "UNAUTHENTICATED");
    await failure(await send("POST", "/import/preview", undefined, {}, false), 403, "FORBIDDEN_ORIGIN");
    await failure(await account("POST", "/import/preview", undefined, {
      raw: "{}", headers: { "Content-Type": "text/plain" },
    }), 422, "IMPORT_INVALID");
    await failure(await account("POST", "/import/preview", undefined, {
      raw: "{}", headers: { "Content-Length": String(64 * 1024 * 1024 + 1) },
    }), 413, "PAYLOAD_TOO_LARGE");
    expect(await hasWorkspace(account)).toBe(false);
    expect((JSON.parse(await download(account)) as PortableDocument).preferences).toEqual(defaultPreferences);
  });
});
