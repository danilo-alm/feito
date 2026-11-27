import "server-only";
import type { MutationHistory, TaskField } from "@feito/core/product/port";
import { Temporal } from "@js-temporal/polyfill";
import { and, count, eq, inArray } from "drizzle-orm";
import { referenceDate } from "@feito/core/domain/preferences";
import {
  childrenByParent, type CompletedOccurrence, type Label, type OccurrenceReference, type Product, type Project, type Section,
  type Task, type TaskComment,
} from "@feito/core/domain/product";
import { walkTaskTree } from "@feito/core/domain/task-tree";
import type { KeyConfig } from "@/server/crypto/config";
import { PAYLOAD_VERSION, sealPayload, type PayloadContext } from "@/server/crypto/envelope";
import { ApiError } from "@/server/errors";
import { preferences as preferenceSchema } from "@feito/core/validation/preferences";
import {
  completedOccurrencePayload, labelPayload, projectPayload, sectionPayload, taskCommentPayload, taskPayload,
} from "@feito/core/validation/product";
import type { Database, Transaction } from "./client";
import { readDesktopRevisions, writeDesktopRevision, type DesktopJournalReferences } from "./desktop-journal";
import {
  desktopClock, DesktopWriteOutcome, readDesktopReceipt, readDesktopTaskClocks, writeDesktopReceipt,
  writeDesktopTaskClocks, type DesktopOperation,
} from "./desktop-sync";
import { withDekWrite, withProductReader, type OpenDek, type ProductReader } from "./product-crypto";
import {
  completedOccurrences, labels, preferences, projects, projectShares, sections, taskComments, taskLabels, tasks, tenants,
} from "./schema";
import { advanceProductRevision, lockTenant, withTenant } from "./tenant";
import { ensureWorkspace, preferenceContext } from "./workspace";

export type ProductAccess = { db: Database; keys: KeyConfig; tenantId: string; desktopOperation?: DesktopOperation };
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

function commentContext(row: Metadata & Pick<TaskComment, "id" | "taskId">) {
  return context(row, "task_comment", [row.taskId]);
}

export async function readCommentRecord(reader: ProductReader, row: typeof taskComments.$inferSelect): Promise<TaskComment> {
  return {
    id: row.id, revision: row.revision, taskId: row.taskId,
    data: await reader(row, commentContext(row), taskCommentPayload),
  };
}

/** Comment counts come from row metadata, without decrypting the comments. */
export async function readCommentCounts(tx: Transaction, taskIds?: string[]) {
  if (taskIds?.length === 0) return new Map<string, number>();
  const rows = await tx.select({ taskId: taskComments.taskId, count: count() }).from(taskComments)
    .where(taskIds ? inArray(taskComments.taskId, taskIds) : undefined).groupBy(taskComments.taskId);
  return new Map(rows.map((row) => [row.taskId, row.count]));
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
    commentCounts: await readCommentCounts(tx),
  };
  return { product, settings };
}

const readOnlySnapshot = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

async function readSnapshot({ db, keys, tenantId, desktopOperation }: ProductAccess, occurrence?: OccurrenceReference) {
  return withTenant(db, tenantId, async (tx) => {
    if (desktopOperation) {
      const replay = await readDesktopReceipt(tx, desktopOperation);
      if (replay) throw replay;
    }
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new Error("Conta indisponível.");
    const [occurrenceRow] = occurrence
      ? await tx.select().from(completedOccurrences).where(and(
        eq(completedOccurrences.taskId, occurrence.taskId), eq(completedOccurrences.occurrenceId, occurrence.occurrenceId),
      ))
      : [];
    const task = desktopOperation?.task;
    const [reusedOccurrence] = task?.newOccurrenceId
      ? await tx.select({ id: completedOccurrences.occurrenceId }).from(completedOccurrences).where(and(
        eq(completedOccurrences.taskId, task.id), eq(completedOccurrences.occurrenceId, task.newOccurrenceId),
      ))
      : [];
    const snapshot = await withProductReader(tx, keys, tenantId, async (reader) => {
      const { product } = await loadProduct(tx, reader);
      return {
        product,
        previousCompletion: occurrenceRow ? await readOccurrenceRecord(reader, occurrenceRow) : undefined,
      };
    });
    const clocks = desktopOperation ? await readDesktopTaskClocks(tx, desktopOperation) : undefined;
    return { revision: tenant.productRevision, ...snapshot, recorded: !!occurrenceRow, clocks, reusedOccurrence: !!reusedOccurrence };
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
    const comments: TaskComment[] = [];
    for (const row of await tx.select().from(taskComments)) comments.push(await readCommentRecord(reader, row));
    return { ...snapshot, occurrences, comments };
  }), readOnlySnapshot);
}

async function readDesktopChanges(tx: Transaction, reader: ProductReader, references: DesktopJournalReferences) {
  async function entityChanges<Row extends { id: string }, Value>(
    ids: string[], read: () => Promise<Row[]>, decode: (row: Row) => Promise<Value>,
  ) {
    const upsert = await mapRows(await read(), decode);
    return { upsert: [...upsert.values()], remove: ids.filter((id) => !upsert.has(id)) };
  }

  const projectIds = references.projects;
  const sectionIds = references.sections;
  const taskIds = references.tasks;
  const labelIds = references.labels;
  const commentIds = references.comments;
  const links = references.taskLabels ? mapTaskLabels(await tx.select().from(taskLabels)
    .where(inArray(taskLabels.taskId, references.taskLabels))) : undefined;
  const history = new Map<string, CompletedOccurrence[]>();
  if (references.occurrences) {
    const rows = await tx.select().from(completedOccurrences).where(inArray(completedOccurrences.taskId, references.occurrences));
    for (const row of rows) {
      const occurrence = await readOccurrenceRecord(reader, row);
      const list = history.get(occurrence.taskId);
      if (list) list.push(occurrence);
      else history.set(occurrence.taskId, [occurrence]);
    }
  }
  const [preference] = references.preferences ? await tx.select().from(preferences) : [];
  if (references.preferences && !preference) throw new Error("Preferências indisponíveis.");

  return {
    preferences: preference ? await readPreferenceRecord(reader, preference) : undefined,
    projects: projectIds && await entityChanges(
      projectIds, () => tx.select().from(projects).where(inArray(projects.id, projectIds)),
      (row) => readProjectRecord(reader, row),
    ),
    sections: sectionIds && await entityChanges(
      sectionIds, () => tx.select().from(sections).where(inArray(sections.id, sectionIds)),
      (row) => readSectionRecord(reader, row),
    ),
    tasks: taskIds && await entityChanges(
      taskIds, () => tx.select().from(tasks).where(inArray(tasks.id, taskIds)),
      (row) => readTaskRecord(reader, row),
    ),
    labels: labelIds && await entityChanges(
      labelIds, () => tx.select().from(labels).where(inArray(labels.id, labelIds)),
      (row) => readLabelRecord(reader, row),
    ),
    taskLabels: references.taskLabels?.map((id): [string, string[]] => [id, links?.get(id) ?? []]),
    occurrences: references.occurrences?.map((id): [string, CompletedOccurrence[]] => [id, history.get(id) ?? []]),
    comments: commentIds && await entityChanges(
      commentIds, () => tx.select().from(taskComments).where(inArray(taskComments.id, commentIds)),
      (row) => readCommentRecord(reader, row),
    ),
  };
}

export async function readDesktopSnapshot(
  { db, keys, tenantId }: ProductAccess, cursor?: number, incremental = false,
) {
  await ensureWorkspace(db, keys, tenantId);
  return withTenant(db, tenantId, async (tx) => {
    const [tenant] = await tx.select({ revision: tenants.productRevision }).from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new Error("Conta indisponível.");
    if (tenant.revision === cursor) return { cursor, workspace: null };
    if (incremental && cursor !== undefined) {
      const references = await readDesktopRevisions(tx, cursor, tenant.revision);
      if (references) {
        const changes = await withProductReader(tx, keys, tenantId, (reader) => readDesktopChanges(tx, reader, references));
        return { cursor: tenant.revision, workspace: null, changes };
      }
    }

    const workspace = await withProductReader(tx, keys, tenantId, async (reader) => {
      const { product, settings } = await loadProduct(tx, reader);
      return {
        preferences: settings,
        projects: [...product.projects.values()],
        sections: [...product.sections.values()],
        tasks: [...product.tasks.values()],
        labels: [...product.labels.values()],
        taskLabels: [...product.taskLabels],
        occurrences: await Promise.all((await tx.select().from(completedOccurrences))
          .map((row) => readOccurrenceRecord(reader, row))),
        comments: await Promise.all((await tx.select().from(taskComments)).map((row) => readCommentRecord(reader, row))),
      };
    });
    return { cursor: tenant.revision, workspace };
  }, readOnlySnapshot);
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

function desktopReferences(plan: Changes, removedOccurrence?: OccurrenceReference): DesktopJournalReferences {
  const ids = (delta: Delta<unknown>) => [...delta.upsert.map(({ id }) => id), ...delta.removed];
  const occurrenceTasks = new Set(plan.task.removed);
  if (removedOccurrence) occurrenceTasks.add(removedOccurrence.taskId);
  if (plan.occurrence) occurrenceTasks.add(plan.occurrence.taskId);
  return {
    projects: ids(plan.project),
    sections: ids(plan.section),
    tasks: ids(plan.task),
    labels: ids(plan.label),
    taskLabels: [...new Set([...ids(plan.links), ...plan.task.removed])],
    occurrences: [...occurrenceTasks],
  };
}

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
    comment(comment: TaskComment) {
      const metadata = fields(comment.revision);
      const { id, taskId, data } = comment;
      return { ...metadata, id, taskId, ...sealPayload(key, commentContext({ tenantId, ...metadata, id, taskId }), data) };
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
  const { db, keys, tenantId, desktopOperation } = access;
  await ensureWorkspace(db, keys, tenantId);
  for (;;) {
    const { product: original, revision, recorded, previousCompletion, clocks, reusedOccurrence } = await readSnapshot(access, occurrence);
    const draft = copyProduct(original);
    if (desktopOperation) {
      draft.now = Temporal.Instant.from(desktopOperation.authoredAt);
      draft.referenceDate = referenceDate(draft.timezone, draft.now);
    }
    const writeClock = desktopClock(draft.now.toString(), desktopOperation?.id);
    let outcome: MutationOutcome<T>;
    let plan: Changes | undefined;
    let touchedTaskFields: MutationHistory["touchedTaskFields"];
    try {
      const history: MutationHistory = { recorded, previousCompletion };
      const task = desktopOperation?.task;
      if (task) {
        if (task.creates && clocks?.deleted) {
          throw new ApiError(409, "DESKTOP_ID_UNAVAILABLE", "O identificador já foi usado.");
        }
        if (task.newOccurrenceId && !recorded
          && (reusedOccurrence || original.tasks.get(task.id)?.occurrenceId === task.newOccurrenceId)) {
          throw new ApiError(409, "DESKTOP_ID_UNAVAILABLE", "O identificador já foi usado.");
        }
        const canEditTaskField = (field: TaskField) => writeClock > (clocks?.[field] ?? "");
        history.canEditTaskField = canEditTaskField;
        if (task.field && !canEditTaskField(task.field) && !recorded) {
          throw new ApiError(409, "DESKTOP_EDIT_SUPERSEDED", "Uma alteração mais recente já foi aplicada.");
        }
      }
      outcome = { value: apply(draft, original, history, revision) };
      plan = changes(original, draft, history.completion);
      touchedTaskFields = history.touchedTaskFields;
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
      if (desktopOperation) {
        const replay = await readDesktopReceipt(tx, desktopOperation);
        if (replay) return replay;
        if ("error" in outcome) {
          await writeDesktopReceipt(tx, tenantId, desktopOperation, outcome.error.code);
          return new DesktopWriteOutcome(outcome.error.code);
        }
        await writeDesktopReceipt(tx, tenantId, desktopOperation, null);
      }
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
      await writeDesktopTaskClocks(tx, tenantId, writeClock, plan.task, plan.links, touchedTaskFields);
      await writeDesktopRevision(tx, tenantId, tenant.productRevision + 1, desktopReferences(plan, options.removeOccurrence));
      await advanceProductRevision(tx, tenant);
      return outcome;
    };
    const result = plan?.encryptions
      ? await withDekWrite(db, keys, tenantId, plan.encryptions, commit)
      : await withTenant(db, tenantId, commit);
    if (result instanceof DesktopWriteOutcome) throw result;
    if (result) return result.value;
  }
}
