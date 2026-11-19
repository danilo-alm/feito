import "server-only";
import { and, asc, eq, exists, gt, inArray } from "drizzle-orm";
import type { Product, Project, Task } from "@/domain/product";
import { notFound } from "@/server/errors";
import { logger } from "@/server/logger";
import type { Transaction } from "./client";
import {
  mapRows, mapTaskLabels, readCalendar, readLabelRecord, readProjectRecord,
  readSectionRecord, readTaskRecord, type ProductAccess,
} from "./product";
import { withProductReader, type ProductReader } from "./product-crypto";
import { labels, preferences, projects, sections, taskLabels, tasks } from "./schema";
import { withTenant } from "./tenant";
import { ensureWorkspace } from "./workspace";

const BATCH_SIZE = 500;

type Scope = {
  projectId?: string;
  labelId?: string;
  skipTasks?: boolean;
  operation: "today" | "upcoming" | "search";
};
type ViewContext = Awaited<ReturnType<typeof readCalendar>>;
type ReadTask = (row: typeof tasks.$inferSelect) => Promise<Task>;

type TaskView = ViewContext & {
  candidates: ReadonlyMap<string, Task>;
  contextFor: (results: Task[]) => Promise<Product>;
};

async function fetchById<T>(ids: Iterable<string>, read: (batch: string[]) => Promise<T[]>) {
  const unique = [...new Set(ids)];
  const rows: T[] = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    rows.push(...await read(unique.slice(i, i + BATCH_SIZE)));
  }
  return rows;
}

async function activeProjects(tx: Transaction, reader: ProductReader, projectId?: string) {
  const rows = await tx.select().from(projects).where(projectId ? eq(projects.id, projectId) : undefined);
  if (projectId && !rows.length) throw notFound();
  const active = new Map<string, Project>();
  for (const row of rows) {
    const project = await readProjectRecord(reader, row);
    if (!project.data.archived) active.set(project.id, project);
  }
  return active;
}

async function scanCandidates(tx: Transaction, decrypt: ReadTask, projectIds: string[], labelId?: string) {
  const result = new Map<string, Task>();
  if (!projectIds.length) return result;

  // Task and label relationships are structural. Dates, text and status are
  // evaluated only after the authorized candidates have been decrypted.
  const labelFilter = labelId ? exists(
    tx.select({ id: taskLabels.labelId }).from(taskLabels).where(and(
      eq(taskLabels.tenantId, tasks.tenantId), eq(taskLabels.taskId, tasks.id), eq(taskLabels.labelId, labelId),
    )),
  ) : undefined;
  const scope = inArray(tasks.projectId, projectIds);
  let after: string | undefined;
  for (;;) {
    const rows: (typeof tasks.$inferSelect)[] = await tx.select().from(tasks)
      .where(and(scope, labelFilter, after ? gt(tasks.id, after) : undefined))
      .orderBy(asc(tasks.id)).limit(BATCH_SIZE);
    for (const row of rows) result.set(row.id, await decrypt(row));
    if (rows.length < BATCH_SIZE) return result;
    after = rows.at(-1)!.id;
  }
}

async function viewContext(
  tx: Transaction, reader: ProductReader, decrypt: ReadTask, calendar: ViewContext,
  active: Map<string, Project>, candidates: ReadonlyMap<string, Task>, labelFiltered: boolean, results: Task[],
) {
  const related = new Map(results.map((task) => [task.id, task]));
  const parents: string[] = [];
  for (const task of results) {
    if (!task.parentId) continue;
    const parent = candidates.get(task.parentId);
    if (parent) related.set(parent.id, parent);
    else parents.push(task.parentId);
  }
  const resultIds = new Set(results.map((task) => task.id));
  if (resultIds.size && !labelFiltered) {
    for (const task of candidates.values()) {
      if (task.parentId && resultIds.has(task.parentId)) related.set(task.id, task);
    }
  }

  const contextRows = await fetchById(parents, (ids) => tx.select().from(tasks).where(inArray(tasks.id, ids)));
  if (labelFiltered) {
    contextRows.push(...await fetchById(resultIds, (ids) => tx.select().from(tasks).where(inArray(tasks.parentId, ids))));
  }
  for (const row of contextRows) {
    const task = candidates.get(row.id) ?? related.get(row.id) ?? await decrypt(row);
    related.set(task.id, task);
  }
  const sectionIds = results.flatMap((task) => task.sectionId ? [task.sectionId] : []);
  const sectionRows = await fetchById(sectionIds, (ids) => tx.select().from(sections).where(inArray(sections.id, ids)));
  const links = await fetchById(results.map((task) => task.id),
    (ids) => tx.select({ taskId: taskLabels.taskId, labelId: taskLabels.labelId })
      .from(taskLabels).where(inArray(taskLabels.taskId, ids)));
  const labelRows = await fetchById(links.map((link) => link.labelId),
    (ids) => tx.select().from(labels).where(inArray(labels.id, ids)));

  return {
    ...calendar, projects: active, tasks: related,
    sections: await mapRows(sectionRows, (row) => readSectionRecord(reader, row)),
    labels: await mapRows(labelRows, (row) => readLabelRecord(reader, row)),
    taskLabels: mapTaskLabels(links),
  } satisfies Product;
}

export async function readTaskView<T>(access: ProductAccess, scope: Scope, run: (view: TaskView) => Promise<T>) {
  const { db, keys, tenantId } = access;
  const start = performance.now();
  await ensureWorkspace(db, keys, tenantId);
  const metrics = { taskCandidates: 0, tasksDecoded: 0, taskCipherBytes: 0, taskDecodeMs: 0 };

  const response = await withTenant(db, tenantId, (tx) => withProductReader(tx, keys, tenantId, async (reader) => {
    const [preference] = await tx.select().from(preferences);
    if (!preference) throw new Error("Preferências indisponíveis.");
    const calendar = await readCalendar(reader, preference);
    if (scope.labelId) {
      const [label] = await tx.select({ id: labels.id }).from(labels).where(eq(labels.id, scope.labelId));
      if (!label) throw notFound();
    }
    const active = scope.skipTasks ? new Map<string, Project>() : await activeProjects(tx, reader, scope.projectId);
    const decrypt: ReadTask = async (row) => {
      const decodeStart = performance.now();
      const task = await readTaskRecord(reader, row);
      metrics.tasksDecoded++;
      metrics.taskCipherBytes += row.ciphertext.length + row.nonce.length + row.tag.length;
      metrics.taskDecodeMs += performance.now() - decodeStart;
      return task;
    };
    const candidates = await scanCandidates(tx, decrypt, [...active.keys()], scope.labelId);
    metrics.taskCandidates = candidates.size;
    return run({
      ...calendar, candidates,
      contextFor: (results) => viewContext(tx, reader, decrypt, calendar, active, candidates, !!scope.labelId, results),
    });
  }), { isolationLevel: "repeatable read", accessMode: "read only" });

  logger.info({
    operation: "task_view_read", view: scope.operation, ...metrics,
    taskDecodeMs: Math.round(metrics.taskDecodeMs), durationMs: Math.round(performance.now() - start),
  });
  return response;
}
