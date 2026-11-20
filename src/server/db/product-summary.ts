import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import { and, eq, exists, gt, inArray } from "drizzle-orm";
import { referenceDate } from "@/domain/preferences";
import { isActive, type Label, type Project } from "@/domain/product";
import { logger } from "@/server/logger";
import type { Transaction } from "./client";
import { productCache, type ProductProjection } from "./product-cache";
import { withProductReader, type ProductReader } from "./product-crypto";
import { mapRows, readLabelRecord, readPreferenceRecord, readProjectRecord, readTaskRecord, type ProductAccess } from "./product";
import { labels, preferences, projects, taskLabels, tasks, tenants } from "./schema";
import { withTenant } from "./tenant";
import { ensureWorkspace } from "./workspace";

const batchSize = 500;

type Summary = {
  projects: Map<string, Project>;
  labels: Map<string, Label>;
  projectCounts: Map<string, number>;
  labelCounts: Map<string, number>;
  todayCount: number;
};
type Calendar = { referenceDate: string; timezone: string };

function increment(counts: Map<string, number>, id: string) {
  counts.set(id, (counts.get(id) ?? 0) + 1);
}

async function loadSummary(
  tx: Transaction, reader: ProductReader, projection: ProductProjection, requestTime: Temporal.Instant,
) {
  let domainQueries = 0;
  const query = async <T>(read: PromiseLike<T>) => {
    domainQueries++;
    return read;
  };

  const projectRecords = await mapRows(await query(tx.select().from(projects)), (row) => readProjectRecord(reader, row));
  const withLabels = projection === "navigation" || projection === "labels";
  const labelRecords = withLabels
    ? await mapRows(await query(tx.select().from(labels)), (row) => readLabelRecord(reader, row)) : new Map<string, Label>();
  let calendar: Calendar | undefined;
  if (projection === "navigation") {
    const [row] = await query(tx.select().from(preferences));
    if (!row) throw new Error("Preferências indisponíveis.");
    const { timezone } = await readPreferenceRecord(reader, row);
    calendar = { timezone, referenceDate: referenceDate(timezone, requestTime) };
  }

  const projectCounts = new Map<string, number>();
  const labelCounts = new Map<string, number>();
  let todayCount = 0;
  const projectIds = [...projectRecords.values()]
    .filter((item) => !item.data.archived && (projection !== "projects:active" || !item.isInbox))
    .map((item) => item.id);

  if (projection !== "projects:archived" && projectIds.length && (projection !== "labels" || labelRecords.size)) {
    const tagged = projection === "labels" ? exists(tx.select({ id: taskLabels.labelId }).from(taskLabels)
      .where(and(eq(taskLabels.tenantId, tasks.tenantId), eq(taskLabels.taskId, tasks.id)))) : undefined;
    let after: string | undefined;
    for (;;) {
      const rows: (typeof tasks.$inferSelect)[] = await query(tx.select().from(tasks)
        .where(and(inArray(tasks.projectId, projectIds), tagged, after ? gt(tasks.id, after) : undefined))
        .orderBy(tasks.id).limit(batchSize));
      const activeIds: string[] = [];
      for (const row of rows) {
        const task = await readTaskRecord(reader, row);
        if (!isActive(task)) continue;
        if (projection !== "labels") increment(projectCounts, task.projectId);
        if (calendar && task.data.dueDate && task.data.dueDate <= calendar.referenceDate) todayCount++;
        if (withLabels && labelRecords.size) activeIds.push(task.id);
      }
      if (activeIds.length) {
        const links = await query(tx.select({ labelId: taskLabels.labelId }).from(taskLabels)
          .where(inArray(taskLabels.taskId, activeIds)));
        for (const { labelId } of links) increment(labelCounts, labelId);
      }
      if (rows.length < batchSize) break;
      after = rows.at(-1)!.id;
    }
  }

  return { summary: { projects: projectRecords, labels: labelRecords, projectCounts, labelCounts, todayCount }, calendar, domainQueries };
}

export async function readProductSummary<T>(
  access: ProductAccess, projection: ProductProjection, select: (summary: Summary, calendar: Calendar | undefined) => T,
) {
  const { db, keys, tenantId } = access;
  const start = performance.now();
  const requestTime = Temporal.Now.instant();
  const read = () => withTenant(db, tenantId, async (tx) => {
    const [tenant] = await tx.select({ revision: tenants.productRevision }).from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) return null;
    // Pin the revision and the projected data to the same committed database snapshot.
    return productCache.read(access, projection, tenant.revision, () =>
      withProductReader(tx, keys, tenantId, async (reader) => {
        const { summary, calendar, domainQueries } = await loadSummary(tx, reader, projection, requestTime);
        return { data: select(summary, calendar), calendar, domainQueries };
      }), ({ calendar }) => !calendar || calendar.referenceDate === referenceDate(calendar.timezone, requestTime));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });

  let result = await read();
  if (!result) {
    await ensureWorkspace(db, keys, tenantId);
    result = await read();
    if (!result) throw new Error("Conta indisponível.");
  }

  logger.info({
    operation: "product_projection_read", projection, cache: result.cache,
    domainQueriesAvoided: result.cache === "hit" || result.cache === "coalesced" ? result.value.domainQueries : 0,
    durationMs: Math.round((performance.now() - start) * 100) / 100,
  });
  return result.value.data;
}
