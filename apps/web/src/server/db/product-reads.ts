import "server-only";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import type { Product, Project } from "@feito/core/domain/product";
import { notFound } from "@/server/errors";
import type { Transaction } from "./client";
import {
  mapRows, mapTaskLabels, readCalendar, readCommentCounts, readLabelRecord, readProjectRecord, readSectionRecord,
  readTaskRecord, type ProductAccess,
} from "./product";
import { withProductReader, type ProductReader } from "./product-crypto";
import { labels, preferences, projects, sections, taskLabels, tasks } from "./schema";
import { withTenant } from "./tenant";
import { ensureWorkspace } from "./workspace";

async function loadCalendar(tx: Transaction, reader: ProductReader, tenantId: string) {
  const [row] = await tx.select().from(preferences).where(eq(preferences.tenantId, tenantId));
  if (!row) throw new Error("Preferências indisponíveis.");
  return readCalendar(reader, row);
}

async function loadLabels(tx: Transaction, reader: ProductReader, tenantId: string, scope: SQL) {
  const taskLinks = tx.select({ taskId: taskLabels.taskId, labelId: taskLabels.labelId })
    .from(taskLabels).innerJoin(tasks, and(eq(tasks.tenantId, taskLabels.tenantId), eq(tasks.id, taskLabels.taskId)))
    .where(and(eq(tasks.tenantId, tenantId), scope));
  const links = await taskLinks;
  const assigned = taskLinks.as("assigned");
  const rows = await tx.select().from(labels).where(and(
    eq(labels.tenantId, tenantId),
    inArray(labels.id, tx.select({ labelId: assigned.labelId }).from(assigned)),
  ));
  return {
    labels: await mapRows(rows, (row) => readLabelRecord(reader, row)),
    taskLabels: mapTaskLabels(links),
  };
}

export async function loadProjectView(tx: Transaction, reader: ProductReader, tenantId: string, project: Project) {
  const calendar = await loadCalendar(tx, reader, tenantId);
  const sectionRows = await tx.select().from(sections)
    .where(and(eq(sections.tenantId, tenantId), eq(sections.projectId, project.id)));
  const scope = eq(tasks.projectId, project.id);
  const taskRows = await tx.select().from(tasks).where(and(eq(tasks.tenantId, tenantId), scope));
  return {
    ...calendar,
    projects: new Map([[project.id, project]]),
    sections: await mapRows(sectionRows, (row) => readSectionRecord(reader, row)),
    tasks: await mapRows(taskRows, (row) => readTaskRecord(reader, row)),
    ...await loadLabels(tx, reader, tenantId, scope),
    // Project pages list task items, which carry no comment count.
    commentCounts: new Map(),
  } satisfies Product;
}

async function readScoped<T>(
  { db, keys, tenantId }: ProductAccess, read: (tx: Transaction, reader: ProductReader) => Promise<T>,
) {
  await ensureWorkspace(db, keys, tenantId);
  return withTenant(db, tenantId, (tx) => withProductReader(tx, keys, tenantId, (reader) => read(tx, reader)),
    { isolationLevel: "repeatable read", accessMode: "read only" });
}

export function readProjectView(access: ProductAccess, id: string) {
  const { tenantId } = access;
  return readScoped(access, async (tx, reader) => {
    const [row] = await tx.select().from(projects).where(and(eq(projects.tenantId, tenantId), eq(projects.id, id)));
    if (!row) throw notFound();
    const project = await readProjectRecord(reader, row);
    const product = await loadProjectView(tx, reader, tenantId, project);
    return { product, project };
  });
}

export function readTaskDetail(access: ProductAccess, id: string) {
  const { tenantId } = access;
  return readScoped(access, async (tx, reader) => {
    const taskTenant = eq(tasks.tenantId, tenantId);
    const [row] = await tx.select().from(tasks).where(and(taskTenant, eq(tasks.id, id)));
    if (!row) throw notFound();
    const [project] = await tx.select().from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.id, row.projectId)));
    const sectionRows = row.sectionId ? await tx.select().from(sections)
      .where(and(eq(sections.tenantId, tenantId), eq(sections.id, row.sectionId))) : [];
    const parentRows = row.parentId ? await tx.select().from(tasks).where(and(taskTenant, eq(tasks.id, row.parentId))) : [];
    const children = and(taskTenant, eq(tasks.parentId, id));
    const childRows = await tx.select().from(tasks).where(children);
    // Each direct child includes its own child IDs and completion counts.
    const grandchildRows = childRows.length ? await tx.select().from(tasks).where(and(
      taskTenant, inArray(tasks.parentId, tx.select({ id: tasks.id }).from(tasks).where(children)),
    )) : [];
    const task = await readTaskRecord(reader, row);
    const related = await mapRows([...parentRows, ...childRows, ...grandchildRows], (item) => readTaskRecord(reader, item));
    related.set(id, task);
    const product = {
      ...await loadCalendar(tx, reader, tenantId),
      projects: await mapRows([project], (item) => readProjectRecord(reader, item)),
      sections: await mapRows(sectionRows, (item) => readSectionRecord(reader, item)),
      tasks: related,
      ...await loadLabels(tx, reader, tenantId, or(eq(tasks.id, id), eq(tasks.parentId, id))!),
      commentCounts: await readCommentCounts(tx, [id]),
    } satisfies Product;
    return { product, task };
  });
}
