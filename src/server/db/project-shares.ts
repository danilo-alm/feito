import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Product } from "@/domain/product";
import { ApiError, notFound } from "@/server/errors";
import type { Transaction } from "./client";
import {
  mapRows, mapTaskLabels, readCalendar, readLabelRecord, readProjectRecord,
  readSectionRecord, readTaskRecord, type ProductAccess,
} from "./product";
import { withProductReader } from "./product-crypto";
import { labels, preferences, projects, projectShares, sections, taskLabels, tasks } from "./schema";
import { setTenantContext, withTenant } from "./tenant";

async function requireProject(tx: Transaction, tenantId: string, id: string, lock: boolean) {
  const query = tx.select().from(projects)
    .where(and(eq(projects.tenantId, tenantId), eq(projects.id, id)));
  const [project] = lock ? await query.for("update") : await query;
  if (!project || project.isInbox) throw notFound();
  return project;
}

export function getProjectShare({ db, keys, tenantId }: ProductAccess, projectId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const row = await requireProject(tx, tenantId, projectId, false);
    const [share] = await tx.select({ token: projectShares.token }).from(projectShares)
      .where(and(eq(projectShares.tenantId, tenantId), eq(projectShares.projectId, projectId)));
    if (!share) return null;
    const project = await withProductReader(tx, keys, tenantId, (reader) => readProjectRecord(reader, row));
    return project.data.archived ? null : share.token;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export function enableProjectShare({ db, keys, tenantId }: ProductAccess, projectId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const row = await requireProject(tx, tenantId, projectId, true);
    const project = await withProductReader(tx, keys, tenantId, (reader) => readProjectRecord(reader, row));
    if (project.data.archived) throw new ApiError(409, "PROJECT_ARCHIVED", "O projeto está arquivado.");
    const [existing] = await tx.select({ token: projectShares.token }).from(projectShares)
      .where(and(eq(projectShares.tenantId, tenantId), eq(projectShares.projectId, projectId)));
    if (existing) return existing.token;

    const token = randomUUID();
    await tx.insert(projectShares).values({ tenantId, projectId, token });
    return token;
  });
}

export function disableProjectShare({ db, tenantId }: ProductAccess, projectId: string) {
  return withTenant(db, tenantId, async (tx) => {
    await requireProject(tx, tenantId, projectId, true);
    await tx.delete(projectShares)
      .where(and(eq(projectShares.tenantId, tenantId), eq(projectShares.projectId, projectId)));
  });
}

export function readSharedProject({ db, keys }: Omit<ProductAccess, "tenantId">, token: string) {
  // Resolve the link and read the project from the same read-only snapshot.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('feito.project_share_token', ${token}, true)`);
    const [share] = await tx.select({ tenantId: projectShares.tenantId, projectId: projectShares.projectId })
      .from(projectShares).where(eq(projectShares.token, token));
    if (!share) throw notFound();

    const { tenantId, projectId } = share;
    await setTenantContext(tx, tenantId);
    return withProductReader(tx, keys, tenantId, async (reader) => {
      const [projectRow] = await tx.select().from(projects).where(and(
        eq(projects.tenantId, tenantId), eq(projects.id, projectId), eq(projects.isInbox, false),
      ));
      if (!projectRow) throw notFound();
      const project = await readProjectRecord(reader, projectRow);
      if (project.data.archived) throw notFound();

      const [preference] = await tx.select().from(preferences).where(eq(preferences.tenantId, tenantId));
      if (!preference) throw new Error("Preferências indisponíveis.");
      const calendar = await readCalendar(reader, preference);
      const projectSections = await mapRows(await tx.select().from(sections)
        .where(and(eq(sections.tenantId, tenantId), eq(sections.projectId, projectId))),
        (row) => readSectionRecord(reader, row));
      const taskScope = and(eq(tasks.tenantId, tenantId), eq(tasks.projectId, projectId));
      const projectTasks = await mapRows(await tx.select().from(tasks).where(taskScope),
        (row) => readTaskRecord(reader, row));
      const projectTaskLabels = tx.select({ taskId: taskLabels.taskId, labelId: taskLabels.labelId })
        .from(taskLabels).innerJoin(tasks, and(eq(tasks.tenantId, taskLabels.tenantId), eq(tasks.id, taskLabels.taskId)))
        .where(taskScope);
      const links = await projectTaskLabels;
      const assigned = projectTaskLabels.as("assigned");
      const projectLabels = await mapRows(await tx.select().from(labels).where(and(
        eq(labels.tenantId, tenantId), inArray(labels.id, tx.select({ labelId: assigned.labelId }).from(assigned)),
      )), (row) => readLabelRecord(reader, row));

      const product: Product = {
        ...calendar, projects: new Map([[project.id, project]]), sections: projectSections,
        tasks: projectTasks, labels: projectLabels, taskLabels: mapTaskLabels(links),
      };
      return { product, project };
    });
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
