import "server-only";
import { and, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { KeyConfig } from "@/server/crypto/config";
import { CipherError, MAX_INVOCATIONS, PAYLOAD_VERSION, openPayload, unwrapDek } from "@/server/crypto/envelope";
import type { Ciphertext, PayloadContext } from "@/server/crypto/envelope";
import type { Database, Transaction } from "./client";
import { dekUsage, legacyAad, tenantKeys, tenants } from "./schema";
import { lockTenant, withTenant } from "./tenant";

export class KeyBudgetError extends Error {}

export async function reserveKek(db: Database, version: number) {
  const result = await db.execute<{ reserved: boolean }>(
    sql`select crypto_ops.reserve_kek_invocation(${version}) as reserved`,
  );
  if (!result.rows[0]?.reserved) throw new KeyBudgetError();
}

export type OpenDek = { key: Buffer; legacyBinding: () => Promise<string> };

async function openDek(tx: Transaction, keys: KeyConfig, tenantId: string, version: number): Promise<OpenDek> {
  const [envelope] = await tx.select().from(tenantKeys)
    .where(and(eq(tenantKeys.tenantId, tenantId), eq(tenantKeys.version, version)));
  if (!envelope) throw new CipherError();
  let binding: Promise<string> | undefined;
  const legacyBinding = () => binding ??= tx.select({ binding: legacyAad.binding }).from(legacyAad).then(([legacy]) => {
    if (!legacy) throw new CipherError();
    return legacy.binding;
  });
  const key = unwrapDek(keys, envelope, envelope.aadVersion === 1 ? await legacyBinding() : undefined);
  return { key, legacyBinding };
}

export async function useDek<T>(
  tx: Transaction, keys: KeyConfig, tenantId: string, version: number, run: (dek: OpenDek) => Promise<T>,
) {
  const dek = await openDek(tx, keys, tenantId, version);
  try {
    return await run(dek);
  } finally {
    dek.key.fill(0);
  }
}

export type ProductReader = <T>(row: Ciphertext & { dekVersion: number }, ctx: PayloadContext, schema: z.ZodType<T>) => Promise<T>;

export async function withProductReader<T>(
  tx: Transaction, keys: KeyConfig, tenantId: string, run: (reader: ProductReader) => Promise<T>,
) {
  const byVersion = new Map<number, Promise<OpenDek>>();
  try {
    return await run(async (row, ctx, schema) => {
      let opened = byVersion.get(row.dekVersion);
      if (!opened) {
        opened = openDek(tx, keys, tenantId, row.dekVersion);
        byVersion.set(row.dekVersion, opened);
      }
      return decodeProduct(await opened, ctx, row, schema);
    });
  } finally {
    for (const key of await Promise.allSettled(byVersion.values())) {
      if (key.status === "fulfilled") key.value.key.fill(0);
    }
  }
}

export async function withDekWrite<T>(
  db: Database,
  keys: KeyConfig,
  tenantId: string,
  count: number,
  run: (tx: Transaction, version: number, dek: OpenDek, tenant: typeof tenants.$inferSelect) => Promise<T>,
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
      return { value: await useDek(tx, keys, tenantId, version, (dek) => run(tx, version, dek, tenant)) };
    });
    if (result) return result.value;
  }
}

export async function decodeProduct<T>(
  dek: OpenDek, ctx: PayloadContext, data: Ciphertext, schema: z.ZodType<T>,
) {
  let binding: string | undefined;
  if (ctx.payloadVersion === 1) binding = await dek.legacyBinding();
  else if (ctx.payloadVersion !== PAYLOAD_VERSION) throw new CipherError();
  const parsed = schema.safeParse(openPayload(dek.key, ctx, data, binding));
  if (!parsed.success) throw new CipherError();
  return parsed.data;
}
