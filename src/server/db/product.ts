import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { referenceDate } from "@/domain/preferences";
import type { Label, Product, Project, Section, Task } from "@/domain/product";
import type { KeyConfig } from "@/server/crypto/config";
import { PAYLOAD_VERSION, sealPayload, type Ciphertext, type PayloadContext } from "@/server/crypto/envelope";
import { ApiError } from "@/server/errors";
import { preferences as preferenceSchema } from "@/validation/account";
import { labelPayload, projectPayload, sectionPayload, taskPayload } from "@/validation/product";
import type { Database, Transaction } from "./client";
import { decodeProduct, useDek, withDekWrite, type OpenDek } from "./product-crypto";
import { labels, preferences, projects, sections, taskLabels, tasks, tenants } from "./schema";
import { lockTenant, withTenant } from "./tenant";
import { ensureWorkspace, preferenceContext } from "./workspace";

export type ProductAccess = { db: Database; keys: KeyConfig; tenantId: string };
type Metadata = Pick<PayloadContext, "tenantId" | "dekVersion" | "payloadVersion" | "revision">;
type PayloadRow = Metadata & Ciphertext;
type VersionReader = <T>(row: PayloadRow, ctx: PayloadContext, schema: z.ZodType<T>) => Promise<T>;

function context(row: Metadata & { id: string }, type: PayloadContext["type"], links: PayloadContext["links"] = []) {
  return { ...row, type, links };
}

function taskContext(row: Metadata & Pick<Task, "id" | "projectId" | "sectionId" | "parentId" | "occurrenceId">) {
  const { projectId, sectionId, parentId, occurrenceId } = row;
  const links = sectionId || parentId || occurrenceId ? [projectId, sectionId, parentId, occurrenceId] : [projectId];
  // Root tasks without other relationships already existed in the Phase 1 format.
  return context(row, "task", links);
}

async function mapRows<Row extends { id: string }, Value>(rows: Row[], decode: (row: Row) => Promise<Value>) {
  const map = new Map<string, Value>();
  for (const row of rows) map.set(row.id, await decode(row));
  return map;
}

async function decodeWorkspace(
  reader: VersionReader,
  projectRows: (typeof projects.$inferSelect)[],
  sectionRows: (typeof sections.$inferSelect)[],
  taskRows: (typeof tasks.$inferSelect)[],
  labelRows: (typeof labels.$inferSelect)[],
  preference: typeof preferences.$inferSelect,
  links: (typeof taskLabels.$inferSelect)[],
): Promise<Product> {
  const { timezone } = await reader(preference, preferenceContext(preference), preferenceSchema);
  const taskLabelIds = new Map<string, string[]>();
  for (const link of links) {
    const existing = taskLabelIds.get(link.taskId);
    if (existing) existing.push(link.labelId);
    else taskLabelIds.set(link.taskId, [link.labelId]);
  }
  return {
    projects: await mapRows(projectRows, async (row): Promise<Project> => ({
      id: row.id, revision: row.revision, isInbox: row.isInbox,
      data: await reader(row, context(row, "project", [row.isInbox]), projectPayload),
    })),
    sections: await mapRows(sectionRows, async (row): Promise<Section> => ({
      id: row.id, revision: row.revision, projectId: row.projectId,
      data: await reader(row, context(row, "section", [row.projectId]), sectionPayload),
    })),
    tasks: await mapRows(taskRows, async (row): Promise<Task> => ({
      id: row.id, revision: row.revision, projectId: row.projectId, sectionId: row.sectionId,
      parentId: row.parentId, occurrenceId: row.occurrenceId,
      data: await reader(row, taskContext(row), taskPayload),
    })),
    labels: await mapRows(labelRows, async (row): Promise<Label> => ({
      id: row.id, revision: row.revision, data: await reader(row, context(row, "label"), labelPayload),
    })),
    taskLabels: taskLabelIds,
    referenceDate: referenceDate(timezone),
  };
}

async function readSnapshot({ db, keys, tenantId }: ProductAccess) {
  return withTenant(db, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [preference] = await tx.select().from(preferences);
    if (!tenant || !preference) throw new Error("Conta indisponível.");
    const projectRows = await tx.select().from(projects);
    const sectionRows = await tx.select().from(sections);
    const taskRows = await tx.select().from(tasks);
    const labelRows = await tx.select().from(labels);
    const links = await tx.select().from(taskLabels);

    const versions = [...new Set([preference, ...projectRows, ...sectionRows, ...taskRows, ...labelRows]
      .map((row) => row.dekVersion))];
    const opened = new Map<number, OpenDek>();
    async function readWithKeys(index: number): Promise<Product> {
      const version = versions[index];
      if (version === undefined) {
        return decodeWorkspace(
          (row, aad, schema) => decodeProduct(opened.get(row.dekVersion)!, aad, row, schema),
          projectRows, sectionRows, taskRows, labelRows, preference, links,
        );
      }
      return useDek(tx, keys, tenantId, version, async (dek) => {
        opened.set(version, dek);
        return readWithKeys(index + 1);
      });
    }

    return { revision: tenant.productRevision, product: await readWithKeys(0) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function readProduct<T>(access: ProductAccess, select: (product: Product) => T) {
  await ensureWorkspace(access.db, access.keys, access.tenantId);
  return select((await readSnapshot(access)).product);
}

type Change<T> = { id: string; previous?: T; next: T };
type Delta<T> = { upsert: Change<T>[]; removed: string[] };

function diff<T>(original: Map<string, T>, current: Map<string, T>): Delta<T> {
  const upsert: Change<T>[] = [];
  const removed: string[] = [];
  for (const [id, next] of current) {
    const previous = original.get(id);
    if (previous !== next) upsert.push({ id, previous, next });
  }
  for (const id of original.keys()) if (!current.has(id)) removed.push(id);
  return { upsert, removed };
}

function changes(original: Product, current: Product) {
  const project = diff(original.projects, current.projects);
  const section = diff(original.sections, current.sections);
  const task = diff(original.tasks, current.tasks);
  const label = diff(original.labels, current.labels);
  const links = diff(original.taskLabels, current.taskLabels);
  const encryptions = project.upsert.length + section.upsert.length + task.upsert.length + label.upsert.length;
  const hasChanges = [project, section, task, label, links].some((delta) => delta.upsert.length || delta.removed.length);
  return { project, section, task, label, links, encryptions, hasChanges };
}

type Changes = ReturnType<typeof changes>;

async function writeEncrypted(tx: Transaction, tenantId: string, version: number, dek: OpenDek, plan: Changes) {
  const fields = (revision: number) => ({ tenantId, dekVersion: version, payloadVersion: PAYLOAD_VERSION, revision });
  for (const { previous, next } of plan.project.upsert) {
    const metadata = fields(next.revision);
    const encrypted = { dekVersion: version, payloadVersion: PAYLOAD_VERSION, revision: next.revision, ...sealPayload(dek.key,
      context({ ...metadata, id: next.id }, "project", [next.isInbox]), next.data) };
    if (previous) await tx.update(projects).set(encrypted).where(eq(projects.id, next.id));
    else await tx.insert(projects).values({ tenantId, ...encrypted, id: next.id, isInbox: next.isInbox });
  }
  for (const { previous, next } of plan.section.upsert) {
    const metadata = fields(next.revision);
    const encrypted = { dekVersion: version, payloadVersion: PAYLOAD_VERSION, revision: next.revision, ...sealPayload(dek.key,
      context({ ...metadata, id: next.id }, "section", [next.projectId]), next.data) };
    if (previous) await tx.update(sections).set(encrypted).where(eq(sections.id, next.id));
    else await tx.insert(sections).values({ tenantId, ...encrypted, id: next.id, projectId: next.projectId });
  }
  for (const { previous, next } of plan.label.upsert) {
    const metadata = fields(next.revision);
    const encrypted = { dekVersion: version, payloadVersion: PAYLOAD_VERSION, revision: next.revision, ...sealPayload(dek.key,
      context({ ...metadata, id: next.id }, "label"), next.data) };
    if (previous) await tx.update(labels).set(encrypted).where(eq(labels.id, next.id));
    else await tx.insert(labels).values({ tenantId, ...encrypted, id: next.id });
  }
  for (const { previous, next } of plan.task.upsert) {
    const metadata = fields(next.revision);
    const { projectId, sectionId, parentId, occurrenceId } = next;
    const links = { projectId, sectionId, parentId, occurrenceId };
    const encrypted = { dekVersion: version, payloadVersion: PAYLOAD_VERSION, revision: next.revision, ...sealPayload(dek.key, taskContext({ ...metadata, ...links, id: next.id }), next.data) };
    if (previous) await tx.update(tasks).set({ ...encrypted, ...links }).where(eq(tasks.id, next.id));
    else await tx.insert(tasks).values({ tenantId, ...encrypted, ...links, id: next.id });
  }
}

async function writeRelationships(tx: Transaction, tenantId: string, plan: Changes) {
  for (const taskId of plan.links.removed) {
    await tx.delete(taskLabels).where(eq(taskLabels.taskId, taskId));
  }
  for (const { id: taskId, next: ids, previous } of plan.links.upsert) {
    const before = new Set(previous);
    const after = new Set(ids);
    for (const labelId of before) {
      if (!after.has(labelId)) {
        await tx.delete(taskLabels).where(and(eq(taskLabels.taskId, taskId), eq(taskLabels.labelId, labelId)));
      }
    }
    const added = ids.filter((labelId) => !before.has(labelId));
    if (added.length) await tx.insert(taskLabels).values(added.map((labelId) => ({ tenantId, taskId, labelId })));
  }
  for (const id of plan.task.removed) await tx.delete(tasks).where(eq(tasks.id, id));
  for (const id of plan.section.removed) await tx.delete(sections).where(eq(sections.id, id));
  for (const id of plan.label.removed) await tx.delete(labels).where(eq(labels.id, id));
  for (const id of plan.project.removed) await tx.delete(projects).where(eq(projects.id, id));
}

function copyProduct(product: Product): Product {
  return {
    ...product, projects: new Map(product.projects), sections: new Map(product.sections),
    tasks: new Map(product.tasks), labels: new Map(product.labels), taskLabels: new Map(product.taskLabels),
  };
}

export async function mutateProduct<T>(
  access: ProductAccess, apply: (draft: Product, original: Product) => T,
): Promise<T> {
  const { db, keys, tenantId } = access;
  await ensureWorkspace(db, keys, tenantId);
  for (;;) {
    const { product: original, revision } = await readSnapshot(access);
    const draft = copyProduct(original);
    let outcome: { value: T } | { error: ApiError };
    let plan: Changes | undefined;
    try {
      outcome = { value: apply(draft, original) };
      plan = changes(original, draft);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      outcome = { error };
    }

    // The encrypted write budget is committed before acquiring the tenant lock.
    // If a competing writer changed the snapshot, the operation is planned again.
    const commit = async (
      tx: Transaction, version?: number, dek?: OpenDek, lockedTenant?: typeof tenants.$inferSelect,
    ) => {
      const tenant = lockedTenant ?? await lockTenant(tx, tenantId);
      if (tenant.productRevision !== revision) return null;
      if ("error" in outcome) throw outcome.error;
      if (!plan?.hasChanges) return outcome;
      if (plan.encryptions) {
        if (!dek || version === undefined) throw new Error("Reserva criptográfica indisponível.");
        await writeEncrypted(tx, tenantId, version, dek, plan);
      }
      await writeRelationships(tx, tenantId, plan);
      await tx.update(tenants).set({ productRevision: revision + 1 }).where(eq(tenants.id, tenantId));
      return outcome;
    };
    const result = plan?.encryptions
      ? await withDekWrite(db, keys, tenantId, plan.encryptions, commit)
      : await withTenant(db, tenantId, commit);
    if (result) return result.value;
  }
}
