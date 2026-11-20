import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import { and, eq } from "drizzle-orm";
import { referenceDate } from "@/domain/preferences";
import { childrenByParent, type CompletedOccurrence, type Label, type OccurrenceReference, type Product, type Project, type Section, type Task } from "@/domain/product";
import { walkTaskTree } from "@/domain/task-tree";
import type { KeyConfig } from "@/server/crypto/config";
import { PAYLOAD_VERSION, sealPayload, type PayloadContext } from "@/server/crypto/envelope";
import { ApiError } from "@/server/errors";
import { preferences as preferenceSchema } from "@/validation/account";
import { completedOccurrencePayload, labelPayload, projectPayload, sectionPayload, taskPayload } from "@/validation/product";
import type { Database, Transaction } from "./client";
import { withDekWrite, withProductReader, type OpenDek, type ProductReader } from "./product-crypto";
import { completedOccurrences, labels, preferences, projects, projectShares, sections, taskLabels, tasks, tenants } from "./schema";
import { advanceProductRevision, lockTenant, withTenant } from "./tenant";
import { ensureWorkspace, preferenceContext } from "./workspace";

export type ProductAccess = { db: Database; keys: KeyConfig; tenantId: string };
type Metadata = Pick<PayloadContext, "tenantId" | "dekVersion" | "payloadVersion" | "revision">;

function context(row: Metadata & { id: string }, type: PayloadContext["type"], links: PayloadContext["links"] = []) {
  return { ...row, type, links };
}

function taskContext(row: Metadata & Pick<Task, "id" | "projectId" | "sectionId" | "parentId" | "occurrenceId">) {
  const { projectId, sectionId, parentId, occurrenceId } = row;
  const links = sectionId || parentId || occurrenceId ? [projectId, sectionId, parentId, occurrenceId] : [projectId];
  // Root tasks without other relationships already existed in the Phase 1 format.
  return context(row, "task", links);
}

export async function mapRows<Row extends { id: string }, Value>(rows: Row[], decode: (row: Row) => Promise<Value>) {
  const map = new Map<string, Value>();
  for (const row of rows) map.set(row.id, await decode(row));
  return map;
}

export function readPreferenceRecord(reader: ProductReader, row: typeof preferences.$inferSelect) {
  return reader(row, preferenceContext(row), preferenceSchema);
}

function calendar(timezone: string) {
  const now = Temporal.Now.instant();
  return { timezone, now, referenceDate: referenceDate(timezone, now) };
}

export async function readCalendar(reader: ProductReader, preference: typeof preferences.$inferSelect) {
  return calendar((await readPreferenceRecord(reader, preference)).timezone);
}

export async function readProjectRecord(reader: ProductReader, row: typeof projects.$inferSelect): Promise<Project> {
  return {
    id: row.id, revision: row.revision, isInbox: row.isInbox,
    data: await reader(row, context(row, "project", [row.isInbox]), projectPayload),
  };
}

export async function readSectionRecord(reader: ProductReader, row: typeof sections.$inferSelect): Promise<Section> {
  return {
    id: row.id, revision: row.revision, projectId: row.projectId,
    data: await reader(row, context(row, "section", [row.projectId]), sectionPayload),
  };
}

export async function readTaskRecord(reader: ProductReader, row: typeof tasks.$inferSelect): Promise<Task> {
  return {
    id: row.id, revision: row.revision, projectId: row.projectId, sectionId: row.sectionId,
    parentId: row.parentId, occurrenceId: row.occurrenceId,
    data: await reader(row, taskContext(row), taskPayload),
  };
}

export async function readLabelRecord(reader: ProductReader, row: typeof labels.$inferSelect): Promise<Label> {
  return {
    id: row.id, revision: row.revision,
    data: await reader(row, context(row, "label"), labelPayload),
  };
}

export function mapTaskLabels(links: Pick<typeof taskLabels.$inferSelect, "taskId" | "labelId">[]) {
  const taskLabelIds = new Map<string, string[]>();
  for (const { taskId, labelId } of links) {
    const existing = taskLabelIds.get(taskId);
    if (existing) existing.push(labelId);
    else taskLabelIds.set(taskId, [labelId]);
  }
  return taskLabelIds;
}

function occurrenceContext(row: Metadata & OccurrenceReference) {
  return context({ ...row, id: row.occurrenceId }, "completed_occurrence", [row.taskId]);
}

export async function readOccurrenceRecord(
  reader: ProductReader, row: typeof completedOccurrences.$inferSelect,
): Promise<CompletedOccurrence> {
  return {
    taskId: row.taskId, occurrenceId: row.occurrenceId,
    data: await reader(row, occurrenceContext(row), completedOccurrencePayload),
  };
}

async function loadProduct(tx: Transaction, reader: ProductReader) {
  const [preference] = await tx.select().from(preferences);
  if (!preference) throw new Error("Preferências indisponíveis.");
  const settings = await readPreferenceRecord(reader, preference);
  const product: Product = {
    ...calendar(settings.timezone),
    projects: await mapRows(await tx.select().from(projects), (row) => readProjectRecord(reader, row)),
    sections: await mapRows(await tx.select().from(sections), (row) => readSectionRecord(reader, row)),
    tasks: await mapRows(await tx.select().from(tasks), (row) => readTaskRecord(reader, row)),
    labels: await mapRows(await tx.select().from(labels), (row) => readLabelRecord(reader, row)),
    taskLabels: mapTaskLabels(await tx.select().from(taskLabels)),
  };
  return { product, settings };
}

const readOnlySnapshot = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

async function readSnapshot({ db, keys, tenantId }: ProductAccess, occurrence?: OccurrenceReference) {
  return withTenant(db, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new Error("Conta indisponível.");
    const [occurrenceRow] = occurrence
      ? await tx.select().from(completedOccurrences).where(and(
        eq(completedOccurrences.taskId, occurrence.taskId), eq(completedOccurrences.occurrenceId, occurrence.occurrenceId),
      ))
      : [];
    const snapshot = await withProductReader(tx, keys, tenantId, async (reader) => {
      const { product } = await loadProduct(tx, reader);
      return {
        product,
        previousCompletion: occurrenceRow ? await readOccurrenceRecord(reader, occurrenceRow) : undefined,
      };
    });
    return { revision: tenant.productRevision, ...snapshot, recorded: !!occurrenceRow };
  }, readOnlySnapshot);
}

export async function readExportSnapshot({ db, keys, tenantId }: ProductAccess) {
  await ensureWorkspace(db, keys, tenantId);
  return withTenant(db, tenantId, (tx) => withProductReader(tx, keys, tenantId, async (reader) => {
    const snapshot = await loadProduct(tx, reader);
    const occurrences: CompletedOccurrence[] = [];
    for (const row of await tx.select().from(completedOccurrences)) {
      occurrences.push(await readOccurrenceRecord(reader, row));
    }
    return { ...snapshot, occurrences };
  }), readOnlySnapshot);
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

function changes(original: Product, current: Product, occurrence?: CompletedOccurrence) {
  const project = diff(original.projects, current.projects);
  const section = diff(original.sections, current.sections);
  const task = diff(original.tasks, current.tasks);
  if (task.removed.length > 1) {
    // Remove dependentes antes dos pais para evitar uma cascata profunda em uma só instrução.
    const removed = new Set(task.removed);
    const deleted = task.removed.map((id) => original.tasks.get(id)!);
    const children = childrenByParent(deleted);
    const roots = deleted.filter((item) => !item.parentId || !removed.has(item.parentId));
    task.removed = Array.from(walkTaskTree(roots, (item) => children.get(item.id) ?? []), ({ task }) => task.id).reverse();
  }
  const label = diff(original.labels, current.labels);
  const links = diff(original.taskLabels, current.taskLabels);
  const encryptions = project.upsert.length + section.upsert.length + task.upsert.length + label.upsert.length
    + Number(occurrence !== undefined);
  const hasChanges = encryptions > 0 || [project, section, task, label, links].some((delta) => delta.removed.length)
    || links.upsert.length > 0;
  return { project, section, task, label, links, occurrence, encryptions, hasChanges };
}

type Changes = ReturnType<typeof changes>;

export function productEncoder(tenantId: string, version: number, key: Buffer) {
  const fields = (revision: number) => ({ dekVersion: version, payloadVersion: PAYLOAD_VERSION, revision });
  return {
    project(project: Project) {
      const metadata = fields(project.revision);
      const aad = context({ tenantId, ...metadata, id: project.id }, "project", [project.isInbox]);
      return { ...metadata, ...sealPayload(key, aad, project.data) };
    },
    section(section: Section) {
      const metadata = fields(section.revision);
      const aad = context({ tenantId, ...metadata, id: section.id }, "section", [section.projectId]);
      return { ...metadata, ...sealPayload(key, aad, section.data) };
    },
    label(label: Label) {
      const metadata = fields(label.revision);
      const aad = context({ tenantId, ...metadata, id: label.id }, "label");
      return { ...metadata, ...sealPayload(key, aad, label.data) };
    },
    task(task: Task) {
      const metadata = fields(task.revision);
      const { projectId, sectionId, parentId, occurrenceId } = task;
      const links = { projectId, sectionId, parentId, occurrenceId };
      return {
        ...metadata, ...links,
        ...sealPayload(key, taskContext({ tenantId, ...metadata, ...links, id: task.id }), task.data),
      };
    },
    occurrence(occurrence: CompletedOccurrence) {
      const metadata = fields(1);
      const { taskId, occurrenceId, data } = occurrence;
      const aad = occurrenceContext({ tenantId, ...metadata, taskId, occurrenceId });
      return { ...metadata, taskId, occurrenceId, ...sealPayload(key, aad, data) };
    },
  };
}

async function writeEncrypted(tx: Transaction, tenantId: string, version: number, dek: OpenDek, plan: Changes) {
  const encode = productEncoder(tenantId, version, dek.key);
  for (const { previous, next } of plan.project.upsert) {
    const encrypted = encode.project(next);
    if (previous) {
      await tx.update(projects).set(encrypted).where(eq(projects.id, next.id));
      // Hold the project row lock while revoking. Unarchive also clears any older link.
      if (previous.data.archived !== next.data.archived) {
        await tx.delete(projectShares).where(and(eq(projectShares.tenantId, tenantId), eq(projectShares.projectId, next.id)));
      }
    } else {
      await tx.insert(projects).values({ tenantId, ...encrypted, id: next.id, isInbox: next.isInbox });
    }
  }
  for (const { previous, next } of plan.section.upsert) {
    const encrypted = encode.section(next);
    if (previous) await tx.update(sections).set(encrypted).where(eq(sections.id, next.id));
    else await tx.insert(sections).values({ tenantId, ...encrypted, id: next.id, projectId: next.projectId });
  }
  for (const { previous, next } of plan.label.upsert) {
    const encrypted = encode.label(next);
    if (previous) await tx.update(labels).set(encrypted).where(eq(labels.id, next.id));
    else await tx.insert(labels).values({ tenantId, ...encrypted, id: next.id });
  }
  for (const { previous, next } of plan.task.upsert) {
    const encrypted = encode.task(next);
    if (previous) await tx.update(tasks).set(encrypted).where(eq(tasks.id, next.id));
    else await tx.insert(tasks).values({ tenantId, ...encrypted, id: next.id });
  }
  if (plan.occurrence) {
    await tx.insert(completedOccurrences).values({ tenantId, ...encode.occurrence(plan.occurrence) });
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

type MutationHistory = { recorded: boolean; completion?: CompletedOccurrence; previousCompletion?: CompletedOccurrence };
type MutationOutcome<T> = { value: T } | { error: ApiError };

export async function mutateProduct<T>(
  access: ProductAccess,
  apply: (draft: Product, original: Product, history: MutationHistory, snapshotRevision: number) => T,
  occurrence?: OccurrenceReference,
  options: {
    beforeCommit?: (tx: Transaction, outcome: MutationOutcome<T>) => Promise<void>;
    removeOccurrence?: OccurrenceReference;
  } = {},
): Promise<T> {
  const { db, keys, tenantId } = access;
  await ensureWorkspace(db, keys, tenantId);
  for (;;) {
    const { product: original, revision, recorded, previousCompletion } = await readSnapshot(access, occurrence);
    const draft = copyProduct(original);
    let outcome: MutationOutcome<T>;
    let plan: Changes | undefined;
    try {
      const history: MutationHistory = { recorded, previousCompletion };
      outcome = { value: apply(draft, original, history, revision) };
      plan = changes(original, draft, history.completion);
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
      await options.beforeCommit?.(tx, outcome);
      if ("error" in outcome) throw outcome.error;
      if (options.removeOccurrence) {
        await tx.delete(completedOccurrences).where(and(
          eq(completedOccurrences.taskId, options.removeOccurrence.taskId),
          eq(completedOccurrences.occurrenceId, options.removeOccurrence.occurrenceId),
        ));
      }
      if (!plan?.hasChanges) return outcome;
      if (plan.encryptions) {
        if (!dek || version === undefined) throw new Error("Reserva criptográfica indisponível.");
        await writeEncrypted(tx, tenantId, version, dek, plan);
      }
      await writeRelationships(tx, tenantId, plan);
      await advanceProductRevision(tx, tenant);
      return outcome;
    };
    const result = plan?.encryptions
      ? await withDekWrite(db, keys, tenantId, plan.encryptions, commit)
      : await withTenant(db, tenantId, commit);
    if (result) return result.value;
  }
}
