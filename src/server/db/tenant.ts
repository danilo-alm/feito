import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "./client";
import { tenants } from "./schema";

export function withTenant<T>(db: Database, tenantId: string, run: (tx: Transaction) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('feito.tenant_id', ${tenantId}, true)`);
    return run(tx);
  });
}

export async function lockTenant(tx: Transaction, tenantId: string) {
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for("update");
  if (!tenant) throw new Error("Contexto de tenant indisponível.");
  return tenant;
}
