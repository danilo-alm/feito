import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "./client";
import { tenants } from "./schema";

export async function setTenantContext(tx: Transaction, tenantId: string) {
  await tx.execute(sql`select set_config('feito.tenant_id', ${tenantId}, true)`);
}

export function withTenant<T>(db: Database, tenantId: string, run: (tx: Transaction) => Promise<T>,
  config?: Parameters<Database["transaction"]>[1],
) {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, tenantId);
    return run(tx);
  }, config);
}

export async function lockTenant(tx: Transaction, tenantId: string) {
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for("update");
  if (!tenant) throw new Error("Contexto de tenant indisponível.");
  return tenant;
}

export async function advanceProductRevision(tx: Transaction, tenant: typeof tenants.$inferSelect) {
  await tx.update(tenants).set({ productRevision: tenant.productRevision + 1 }).where(eq(tenants.id, tenant.id));
}
