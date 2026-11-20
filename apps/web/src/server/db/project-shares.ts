import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { ApiError, notFound } from "@/server/errors";
import type { Transaction } from "./client";
import { readProjectRecord, type ProductAccess } from "./product";
import { withProductReader } from "./product-crypto";
import { loadProjectView } from "./product-reads";
import { projects, projectShares } from "./schema";
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

      const product = await loadProjectView(tx, reader, tenantId, project);
      return { product, project };
    });
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
