import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { KeyConfig } from "@/server/crypto/config";
import { sealPayload } from "@/server/crypto/envelope";
import type { PayloadContext } from "@/server/crypto/envelope";
import { notFound } from "@/server/errors";
import { taskPayload, type TaskPayload } from "@/validation/task-payload";
import type { Database } from "./client";
import { decodeProduct, useDek, withDekWrite } from "./product-crypto";
import { projects, tasks } from "./schema";
import { withTenant } from "./tenant";

function taskContext(row: Pick<typeof tasks.$inferSelect,
  "id" | "tenantId" | "projectId" | "dekVersion" | "payloadVersion" | "revision">): PayloadContext {
  return { ...row, type: "task", links: [row.projectId] };
}

export function insertTask(
  db: Database, keys: KeyConfig, tenantId: string, projectId: string, input: TaskPayload,
) {
  const payload = taskPayload.parse(input);
  return withDekWrite(db, keys, tenantId, 1, async (tx, dekVersion, dek) => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
    if (!project) throw notFound();
    const row = { id: randomUUID(), tenantId, projectId, dekVersion, payloadVersion: 1, revision: 1 };
    await tx.insert(tasks).values({
      ...row, ...sealPayload(keys.installationId, dek, taskContext(row), payload),
    });
    return row.id;
  });
}

export function readTask(db: Database, keys: KeyConfig, tenantId: string, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx.select().from(tasks).where(eq(tasks.id, id));
    if (!row) throw notFound();
    return useDek(tx, keys, tenantId, row.dekVersion, async (dek) =>
      decodeProduct(keys, dek, taskContext(row), row, taskPayload));
  });
}
