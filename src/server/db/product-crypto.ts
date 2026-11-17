import "server-only";
import { and, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { KeyConfig } from "@/server/crypto/config";
import { CipherError, MAX_INVOCATIONS, openPayload, unwrapDek } from "@/server/crypto/envelope";
import type { Ciphertext, PayloadContext } from "@/server/crypto/envelope";
import type { Database, Transaction } from "./client";
import { dekUsage, tenantKeys, tenants } from "./schema";
import { lockTenant, withTenant } from "./tenant";

export class KeyBudgetError extends Error {}

export async function reserveKek(db: Database, version: number) {
  const result = await db.execute<{ reserved: boolean }>(
    sql`select crypto_ops.reserve_kek_invocation(${version}) as reserved`,
  );
  if (!result.rows[0]?.reserved) throw new KeyBudgetError();
}

export async function useDek<T>(
  tx: Transaction, keys: KeyConfig, tenantId: string, version: number, run: (dek: Buffer) => Promise<T>,
) {
  const [envelope] = await tx.select().from(tenantKeys)
    .where(and(eq(tenantKeys.tenantId, tenantId), eq(tenantKeys.version, version)));
  if (!envelope) throw new CipherError();
  const dek = unwrapDek(keys, envelope);
  try {
    return await run(dek);
  } finally {
    dek.fill(0);
  }
}

export async function withDekWrite<T>(
  db: Database,
  keys: KeyConfig,
  tenantId: string,
  count: number,
  run: (tx: Transaction, version: number, dek: Buffer) => Promise<T>,
): Promise<T> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_INVOCATIONS) throw new KeyBudgetError();
  for (;;) {
    // Commit the reservation before taking the tenant lock. Rollbacks do not refund it.
    const version = await withTenant(db, tenantId, async (tx) => {
      const [reserved] = await tx.update(dekUsage)
        .set({ invocations: sql`${dekUsage.invocations} + ${count}` })
        .where(and(
          eq(dekUsage.tenantId, tenantId),
          eq(dekUsage.dekVersion, tx.select({ version: tenants.activeDekVersion })
            .from(tenants).where(eq(tenants.id, tenantId))),
          lte(dekUsage.invocations, MAX_INVOCATIONS - count),
        ))
        .returning({ version: dekUsage.dekVersion });
      if (!reserved) throw new KeyBudgetError();
      return reserved.version;
    });

    const result = await withTenant(db, tenantId, async (tx) => {
      const tenant = await lockTenant(tx, tenantId);
      if (tenant.activeDekVersion !== version) return null;
      return { value: await useDek(tx, keys, tenantId, version, (dek) => run(tx, version, dek)) };
    });
    if (result) return result.value;
  }
}

export function decodeProduct<T>(
  keys: KeyConfig, dek: Buffer, ctx: PayloadContext, data: Ciphertext, schema: z.ZodType<T>,
) {
  if (ctx.payloadVersion !== 1) throw new CipherError();
  const parsed = schema.safeParse(openPayload(keys.installationId, dek, ctx, data));
  if (!parsed.success) throw new CipherError();
  return parsed.data;
}
