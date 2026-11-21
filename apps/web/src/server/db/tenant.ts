import "server-only";
import { DrizzleQueryError, eq, sql } from "drizzle-orm";
import { DatabaseError } from "pg";
import type { Database, Transaction } from "./client";
import { productCache, usesLocalProductCache } from "./product-cache";
import { tenants } from "./schema";

const revisedTransactions = new WeakSet<Transaction>();

export async function setTenantContext(tx: Transaction, tenantId: string) {
  await tx.execute(sql`select set_config('feito.tenant_id', ${tenantId}, true)`);
}

export async function withTenant<T>(db: Database, tenantId: string, run: (tx: Transaction) => Promise<T>,
  config?: Parameters<Database["transaction"]>[1],
) {
  let finishCommit: ReturnType<typeof productCache.beginCommit> | undefined;
  let result: T;
  try {
    result = await db.transaction(async (tx) => {
      await setTenantContext(tx, tenantId);
      const value = await run(tx);
      // Drizzle sends COMMIT after this callback returns. Fence cache reads before it can become visible.
      if (revisedTransactions.has(tx)) finishCommit = productCache.beginCommit(tenantId);
      return value;
    }, config);
  } catch (error) {
    if (finishCommit) {
      // Losing the connection can leave the commit outcome unknown. Discard the cache in that case.
      const rejected = error instanceof DrizzleQueryError && error.query === "commit"
        && error.cause instanceof DatabaseError && error.cause.severity === "ERROR"
        && error.cause.code !== "40003";
      finishCommit(!rejected);
    }
    throw error;
  }
  finishCommit?.(true);
  return result;
}

export async function lockTenant(tx: Transaction, tenantId: string) {
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for("update");
  if (!tenant) throw new Error("Contexto de tenant indisponível.");
  return tenant;
}

export async function advanceProductRevision(tx: Transaction, tenant: typeof tenants.$inferSelect) {
  await tx.update(tenants).set({ productRevision: tenant.productRevision + 1 }).where(eq(tenants.id, tenant.id));
  await tx.execute(sql`select pg_notify('feito_product_revision', encode(sha256(convert_to(${tenant.id}, 'UTF8')), 'hex'))`);
  if (usesLocalProductCache()) revisedTransactions.add(tx);
}
