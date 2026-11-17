import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { inboxName } from "@/domain/product";
import { defaultPreferences } from "@/domain/preferences";
import type { KeyConfig } from "@/server/crypto/config";
import { PAYLOAD_VERSION, sealPayload, wrapDek } from "@/server/crypto/envelope";
import type { PayloadContext } from "@/server/crypto/envelope";
import { preferences as preferencesSchema, type Preferences } from "@/validation/account";
import type { Database, Transaction } from "./client";
import { decodeProduct, reserveKek, useDek, withDekWrite } from "./product-crypto";
import { dekUsage, preferences, projects, tenantKeys, tenants } from "./schema";
import { advanceProductRevision, lockTenant, withTenant } from "./tenant";

export function preferenceContext(row: Pick<typeof preferences.$inferSelect,
  "tenantId" | "dekVersion" | "payloadVersion" | "revision">): PayloadContext {
  return { ...row, type: "preferences", id: row.tenantId, links: [] };
}

export async function bootstrapWorkspace<T>(
  db: Database, keys: KeyConfig, tenantId: string, additionalWrites: number,
  run: (tx: Transaction, tenant: typeof tenants.$inferSelect, key: Buffer, inboxId: string) => Promise<T>,
) {
  const kekVersion = keys.activeVersion;
  await reserveKek(db, kekVersion);

  return withTenant(db, tenantId, async (tx) => {
    const version = 1;
    const [created] = await tx.insert(tenants).values({ id: tenantId, activeDekVersion: version })
      .onConflictDoNothing().returning({ id: tenants.id });
    if (!created) return null;
    const tenant = await lockTenant(tx, tenantId);

    const dek = randomBytes(32);
    try {
      const envelope = { tenantId, version, kekVersion };
      await tx.insert(tenantKeys).values({ ...envelope, ...wrapDek(keys, envelope, dek) });
      // A new, unpublished DEK is discarded on rollback and is never used again.
      await tx.insert(dekUsage).values({ tenantId, dekVersion: version, invocations: 2 + additionalWrites });

      const metadata = { tenantId, dekVersion: version, payloadVersion: PAYLOAD_VERSION, revision: 1 };
      await tx.insert(preferences).values({
        ...metadata,
        ...sealPayload(dek, preferenceContext(metadata), defaultPreferences),
      });
      const inbox = { ...metadata, id: randomUUID(), isInbox: true };
      await tx.insert(projects).values({
        ...inbox,
        ...sealPayload(dek, {
          ...metadata, type: "project", id: inbox.id, links: [inbox.isInbox],
        }, {
          name: inboxName,
          archived: false,
          view: { layout: "list", sortMode: "manual", showCompleted: false },
        }),
      });
      return { value: await run(tx, tenant, dek, inbox.id) };
    } finally {
      dek.fill(0);
    }
  });
}

export async function ensureWorkspace(db: Database, keys: KeyConfig, tenantId: string) {
  const exists = await withTenant(db, tenantId, async (tx) => {
    const [tenant] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
    return !!tenant;
  });
  if (!exists) await bootstrapWorkspace(db, keys, tenantId, 0, async () => undefined);
}

async function preferenceRow(tx: Transaction, tenantId: string) {
  const [row] = await tx.select().from(preferences).where(eq(preferences.tenantId, tenantId));
  if (!row) throw new Error("Preferências indisponíveis.");
  return row;
}

async function readPreferences(tx: Transaction, keys: KeyConfig, row: typeof preferences.$inferSelect) {
  return useDek(tx, keys, row.tenantId, row.dekVersion, async (dek) =>
    decodeProduct(dek, preferenceContext(row), row, preferencesSchema));
}

export function readWorkspace(db: Database, keys: KeyConfig, tenantId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [inbox] = await tx.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.isInbox, true)));
    if (!inbox) throw new Error("Caixa de entrada indisponível.");
    return {
      inboxProjectId: inbox.id,
      preferences: await readPreferences(tx, keys, await preferenceRow(tx, tenantId)),
    };
  });
}

export async function persistPreferences(
  db: Database, keys: KeyConfig, tenantId: string, patch: Partial<Preferences>,
) {
  if (!Object.keys(patch).length) return (await readWorkspace(db, keys, tenantId)).preferences;

  return withDekWrite(db, keys, tenantId, 1, async (tx, version, dek, tenant) => {
    const row = await preferenceRow(tx, tenantId);
    const current = row.dekVersion === version
      ? await decodeProduct(dek, preferenceContext(row), row, preferencesSchema)
      : await readPreferences(tx, keys, row);
    const updated = { ...current, ...patch };
    await writePreferences(tx, tenantId, version, dek.key, row.revision + 1, updated);
    await advanceProductRevision(tx, tenant);
    return updated;
  });
}


export async function writePreferences(
  tx: Transaction, tenantId: string, version: number, key: Buffer, revision: number, value: Preferences,
) {
  const metadata = { dekVersion: version, payloadVersion: PAYLOAD_VERSION, revision };
  await tx.update(preferences).set({
    ...metadata,
    ...sealPayload(key, preferenceContext({ tenantId, ...metadata }), value),
  }).where(eq(preferences.tenantId, tenantId));
}
